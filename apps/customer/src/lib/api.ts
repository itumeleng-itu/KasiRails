import type { Order } from '@kasi-rails/shared';
import type { TransferAuthorization, UsdcDomain } from './wallet';

/** Default server, used for the balance. Payments use the server named in the shop's QR code. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

const TIMEOUT_MS = 15_000;
const PAY_TIMEOUT_MS = 70_000; // the server waits up to ~45s for the network to confirm

export type ShopOrder = Order & { shopName: string; shopAddress: `0x${string}` };

export interface Balance {
  address: string;
  usdcAmount: string;
  usdc: string;
  zarCents: number;
  zarPerUsdc: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; body: T }> {
  if (!base) throw new ApiError('The app is not set up yet (no server address).', 0, 'NO_API');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError("Can't reach the shop's server. Check your internet and try again.", 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status, body.code);
  return { status: res.status, body: body as T };
}

export async function getBalance(address: string, api = API_URL): Promise<Balance> {
  return (await request<Balance>(api, `/balance/${address}`)).body;
}

export async function getOrder(api: string, orderId: string): Promise<ShopOrder> {
  return (await request<ShopOrder>(api, `/orders/${encodeURIComponent(orderId)}`)).body;
}

export async function getUsdcDomain(api: string): Promise<UsdcDomain> {
  return (await request<UsdcDomain>(api, '/usdc-domain')).body;
}

/** Returns the order and whether the network has confirmed it yet (HTTP 200 vs 202). */
export async function payOrder(api: string, orderId: string, auth: TransferAuthorization): Promise<{ order: ShopOrder; confirmed: boolean }> {
  const { status, body } = await request<ShopOrder>(
    api,
    `/orders/${encodeURIComponent(orderId)}/pay`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(auth) },
    PAY_TIMEOUT_MS,
  );
  return { order: body, confirmed: status === 200 };
}

/** Parses the till's QR: {"kasiRails":1,"orderId":"…","api":"http://…"}. */
export function parseTillQr(data: string): { orderId: string; api: string } | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed?.kasiRails !== 1 || typeof parsed.orderId !== 'string' || !parsed.orderId) return null;
    const api = typeof parsed.api === 'string' && /^https?:\/\//.test(parsed.api) ? parsed.api.replace(/\/+$/, '') : API_URL;
    return { orderId: parsed.orderId, api };
  } catch {
    return null;
  }
}
