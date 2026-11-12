import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, USDC_ADDRESS, transferWithAuthorizationTypes, usdcToZarCents, zarCentsToUsdc, type TopUp } from '@kasi-rails/shared';
import { getUsdcDomain, publicClient, usdcBalance, type Relayer } from './chain';
import { HttpError, verifyAndSubmit } from './payments';
import { getRate } from './rate';
import type { OrderRepo } from './repo';

const RECEIPT_TIMEOUT_MS = 45_000;
const AUTH_VALIDITY_S = 300;

// PIN guessing protection: after too many wrong PINs, refuse all PIN checks for a while.
const MAX_PIN_FAILURES = 10;
const PIN_LOCK_MS = 10 * 60 * 1000;

export interface Float {
  usdcAmount: string;
  zarCents: number;
  zarPerUsdc: number;
  feeBps: number;
}

export function createTopUps(deps: { repo: OrderRepo; relayer: Relayer; shopKey: Hex; feeBps: number; ownerPin: string; fallbackZarPerUsdc: number }) {
  const { repo, relayer, feeBps, ownerPin, fallbackZarPerUsdc } = deps;
  const shop = privateKeyToAccount(deps.shopKey);
  let busy = false;
  let pinFailures = 0;
  let pinLockedUntil = 0;

  /** Throws unless `pin` matches OWNER_PIN. */
  function checkPin(pin: unknown) {
    if (Date.now() < pinLockedUntil) throw new HttpError(429, 'Too many wrong PINs. Try again in a few minutes.', 'PIN_LOCKED');
    const given = Buffer.from(typeof pin === 'string' ? pin : '');
    const expected = Buffer.from(ownerPin);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      pinFailures += 1;
      if (pinFailures >= MAX_PIN_FAILURES) {
        pinLockedUntil = Date.now() + PIN_LOCK_MS;
        pinFailures = 0;
      }
      throw new HttpError(401, 'Wrong PIN.', 'BAD_PIN');
    }
    pinFailures = 0;
  }

  async function getFloat(): Promise<Float> {
    const [units, rate] = await Promise.all([usdcBalance(shop.address), getRate(fallbackZarPerUsdc)]);
    return { usdcAmount: units.toString(), zarCents: usdcToZarCents(units, rate.zarPerUsdc), zarPerUsdc: rate.zarPerUsdc, feeBps };
  }

  /**
   * Customer pays `zarCents` in cash; they receive USDC worth that amount minus the fee,
   * sent from the shop's float. The shop signs; the relayer submits and pays gas.
   */
  async function topUp(zarCents: number, customer: unknown): Promise<{ topUp: TopUp; confirmed: boolean; float: Float }> {
    if (typeof customer !== 'string' || !isAddress(customer)) throw new HttpError(400, "That isn't a valid customer code.", 'BAD_REQUEST');
    const customerAddress = getAddress(customer);
    if (customerAddress === shop.address) throw new HttpError(400, "That's the shop's own code.", 'BAD_REQUEST');

    if (busy) throw new HttpError(409, 'Another top-up is being sent. Try again in a moment.', 'IN_PROGRESS');
    busy = true;
    try {
      const { zarPerUsdc } = await getRate(fallbackZarPerUsdc);
      const feeZarCents = Math.floor((zarCents * feeBps) / 10_000);
      const usdcAmount = zarCentsToUsdc(zarCents - feeZarCents, zarPerUsdc);
      if (usdcAmount === 0n) throw new HttpError(400, 'Amount is too small.', 'BAD_REQUEST');

      const floatUnits = await usdcBalance(shop.address);
      if (floatUnits < usdcAmount) {
        throw new HttpError(409, `Not enough float. The shop has R${(usdcToZarCents(floatUnits, zarPerUsdc) / 100).toFixed(2)}.`, 'NOT_ENOUGH_FLOAT');
      }

      const domain = await getUsdcDomain();
      if (domain.chainId !== CHAIN_ID || domain.verifyingContract !== USDC_ADDRESS) throw new Error('Unexpected USDC domain');
      const message = {
        from: shop.address as Address,
        to: customerAddress,
        value: usdcAmount,
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + AUTH_VALIDITY_S),
        nonce: toHex(randomBytes(32)),
      };
      const signature = await shop.signTypedData({ domain, types: transferWithAuthorizationTypes, primaryType: 'TransferWithAuthorization', message });
      const hash = await verifyAndSubmit(relayer, message, signature, 'Could not sign the top-up.');

      let confirmed = true;
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        if (receipt.status !== 'success') throw new HttpError(502, 'The top-up failed on the network. Nothing was sent; please try again.', 'TX_REVERTED');
      } catch (err) {
        if (err instanceof HttpError) throw err;
        confirmed = false; // submitted; the receipt is just slow
      }

      const record: TopUp = {
        id: randomUUID(),
        zarCents,
        feeZarCents,
        usdcAmount: usdcAmount.toString(),
        customerAddress,
        txHash: hash,
        createdAt: new Date().toISOString(),
      };
      await repo.createTopUp(record).catch((err) => console.error('Saving top-up failed:', err instanceof Error ? err.message : err));
      console.log(`Top-up: R${(zarCents / 100).toFixed(2)} cash -> ${customerAddress} (${hash})`);
      return { topUp: record, confirmed, float: await getFloat() };
    } finally {
      busy = false;
    }
  }

  return { checkPin, getFloat, topUp };
}

export type TopUps = ReturnType<typeof createTopUps>;
