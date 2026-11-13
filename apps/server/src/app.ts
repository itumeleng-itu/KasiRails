import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request } from 'express';
import QRCode from 'qrcode';
import { formatUnits, getAddress, isAddress } from 'viem';
import { USDC_DECIMALS, usdcToZarCents, zarCentsToUsdc, type Order, type OrderType } from '@kasi-rails/shared';
import { getUsdcDomain, usdcBalance } from './chain';
import type { Config } from './config';
import { HttpError, type Payments } from './payments';
import { getHistory } from './history';
import { getRate } from './rate';
import type { OrderRepo } from './repo';
import { createRequire } from 'node:module';
import { publicUrl } from './network';
import type { TopUps } from './topups';
import { createUsersRouter } from './users';
import { ROOT_DIR } from './paths';

const PUBLIC_DIR = resolve(ROOT_DIR, 'apps/server/public');
const MAX_ZAR_CENTS = 10_000_00; // R10,000 per order
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // South Africa: UTC+2, no DST

/** Midnight today in South African time. */
function startOfTodaySast(now = Date.now()): Date {
  const local = new Date(now + SAST_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - SAST_OFFSET_MS);
}

function parseZarCents(zar: unknown): number {
  const n = typeof zar === 'string' && zar.trim() !== '' ? Number(zar) : zar;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'zar must be a number of rand, e.g. 85 or 85.50.', 'BAD_REQUEST');
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw new HttpError(400, 'zar can have at most 2 decimal places.', 'BAD_REQUEST');
  if (cents <= 0) throw new HttpError(400, 'zar must be more than 0.', 'BAD_REQUEST');
  if (cents > MAX_ZAR_CENTS) throw new HttpError(400, `zar must be at most R${MAX_ZAR_CENTS / 100}.`, 'BAD_REQUEST');
  return cents;
}

export function createApp(deps: { config: Config; repo: OrderRepo; payments: Payments; topUps: TopUps }) {
  const { config, repo, payments, topUps } = deps;
  const app = express();
  app.disable('x-powered-by');
  // Behind one proxy when hosted (e.g. Railway), so req.ip is the caller's address.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));

  // One line per API request (method, path, status, time, caller IP); vendor page assets are skipped.
  app.use((req, res, next) => {
    if (req.path.startsWith('/vendor/') && !req.path.endsWith('.svg')) return next();
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms from ${req.ip}`);
    });
    next();
  });

  const withShop = (order: Order) => ({ ...order, shopName: config.shopName, shopAddress: config.shopAddress });

  async function findOrder(req: Request<{ id: string }>) {
    const order = await repo.get(req.params.id);
    if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
    return order;
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, shopName: config.shopName, apiUrl: publicUrl(config.port, config.publicUrlOverride), store: repo.kind, time: new Date().toISOString() });
  });

  app.get('/rate', async (_req, res) => {
    res.json(await getRate(config.fallbackZarPerUsdc));
  });

  app.get('/usdc-domain', async (_req, res) => {
    res.json(await getUsdcDomain());
  });

  app.post('/orders', async (req, res) => {
    const zarCents = parseZarCents(req.body?.zar);
    const type: OrderType = req.body?.type ?? 'sale';
    if (type !== 'sale' && type !== 'cashout') throw new HttpError(400, "type must be 'sale' or 'cashout'.", 'BAD_REQUEST');

    const { zarPerUsdc } = await getRate(config.fallbackZarPerUsdc);
    const usdcAmount = zarCentsToUsdc(zarCents, zarPerUsdc);
    if (usdcAmount === 0n) throw new HttpError(400, 'Amount is too small.', 'BAD_REQUEST');

    const now = Date.now();
    const order: Order = {
      id: randomUUID(),
      type,
      zarCents,
      usdcAmount: usdcAmount.toString(),
      status: 'PENDING',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.orderTtlSeconds * 1000).toISOString(),
    };
    await repo.create(order);
    res.status(201).json(withShop(order));
  });

  app.get('/orders', async (req, res) => {
    if (req.query.day !== 'today') throw new HttpError(400, 'Use ?day=today.', 'BAD_REQUEST');
    res.json({ orders: await repo.listCreatedSince(startOfTodaySast()) });
  });

  app.get('/orders/:id', async (req, res) => {
    res.json(withShop(await findOrder(req)));
  });

  app.post('/orders/:id/pay', async (req, res) => {
    const { order, confirmed } = await payments.pay(req.params.id, req.body ?? {});
    res.status(confirmed ? 200 : 202).json(withShop(order));
  });

  // Person-to-person payment (friend to friend), relayed gaslessly.
  app.post('/transfers', async (req, res) => {
    const { txHash, confirmed } = await payments.transfer(req.body ?? {});
    res.status(confirmed ? 200 : 202).json({ txHash, confirmed });
  });

  app.get('/history/:address', async (req, res) => {
    if (!isAddress(req.params.address)) throw new HttpError(400, 'Not a valid address.', 'BAD_REQUEST');
    const rate = await getRate(config.fallbackZarPerUsdc);
    try {
      const items = await getHistory(getAddress(req.params.address), {
        zarPerUsdc: rate.zarPerUsdc,
        knownShops: { [config.shopAddress]: config.shopName },
      });
      res.json({ items, zarPerUsdc: rate.zarPerUsdc });
    } catch (err) {
      console.warn('History lookup failed:', err instanceof Error ? err.message : err);
      throw new HttpError(503, "Couldn't load your history right now. Pull down to try again.", 'HISTORY_UNAVAILABLE');
    }
  });

  app.get('/balance/:address', async (req, res) => {
    if (!isAddress(req.params.address)) throw new HttpError(400, 'Not a valid address.', 'BAD_REQUEST');
    const address = getAddress(req.params.address);
    const [units, rate] = await Promise.all([usdcBalance(address), getRate(config.fallbackZarPerUsdc)]);
    res.json({
      address,
      usdcAmount: units.toString(),
      usdc: formatUnits(units, USDC_DECIMALS),
      zarCents: usdcToZarCents(units, rate.zarPerUsdc),
      zarPerUsdc: rate.zarPerUsdc,
      rateSource: rate.source,
    });
  });

  // Vendor pages. The QR is drawn server-side as SVG; the page decides its content.
  app.use('/users', createUsersRouter(repo));

  // ---- Shop owner: cash top-ups (PIN in the x-owner-pin header)
  app.post('/owner/check-pin', (req, res) => {
    topUps.checkPin(req.get('x-owner-pin'));
    res.json({ ok: true });
  });

  app.get('/float', async (_req, res) => {
    res.json({ ...(await topUps.getFloat()), shopName: config.shopName, shopAddress: config.shopAddress });
  });

  app.post('/topups', async (req, res) => {
    topUps.checkPin(req.get('x-owner-pin'));
    const zarCents = parseZarCents(req.body?.zar);
    const result = await topUps.topUp(zarCents, req.body?.customerAddress);
    res.status(result.confirmed ? 201 : 202).json(result);
  });

  app.get('/topups', async (req, res) => {
    topUps.checkPin(req.get('x-owner-pin'));
    if (req.query.day !== 'today') throw new HttpError(400, 'Use ?day=today.', 'BAD_REQUEST');
    res.json({ topUps: await repo.listTopUpsSince(startOfTodaySast()) });
  });

  // Browser build of the QR scanner used by the top-up page.
  const html5QrcodePath = createRequire(import.meta.url).resolve('html5-qrcode/html5-qrcode.min.js');
  app.get('/vendor/lib/html5-qrcode.min.js', (_req, res) => {
    res.type('application/javascript').sendFile(html5QrcodePath);
  });

  app.get('/vendor/qr.svg', async (req, res) => {
    const data = req.query.data;
    if (typeof data !== 'string' || !data || data.length > 512) throw new HttpError(400, 'data is required (max 512 chars).', 'BAD_REQUEST');
    const svg = await QRCode.toString(data, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });
  app.use('/vendor', express.static(PUBLIC_DIR));
  app.get('/', (_req, res) => res.redirect('/vendor/till.html'));

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found.', 'NOT_FOUND')));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON.', code: 'BAD_REQUEST' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
  };
  app.use(onError);

  return app;
}
