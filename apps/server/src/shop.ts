import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TransactionReceiptNotFoundError, getAddress, isAddress, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, USDC_ADDRESS, feeZarCents as feeFor, transferWithAuthorizationTypes, usdcToZarCents, zarCentsToUsdc, type Fees, type Order, type TopUp } from '@kasi-rails/shared';
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
  minFeeZarCents: number;
}

/**
 * Shop-owner actions that spend the shop's USDC float: cash top-ups and refunds.
 * The shop signs EIP-3009 transfers; the relayer submits them and pays gas.
 */
export function createShopOwner(deps: { repo: OrderRepo; relayer: Relayer; shopKey: Hex; fees: Fees; ownerPin: string; fallbackZarPerUsdc: number }) {
  const { repo, relayer, fees, ownerPin, fallbackZarPerUsdc } = deps;
  const shop = privateKeyToAccount(deps.shopKey);
  /** One float spend at a time, so two sends can't both pass the float check. */
  let busy = false;
  /** Refunds submitted by this process and not yet settled. */
  const refundsInFlight = new Set<string>();
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
    return { usdcAmount: units.toString(), zarCents: usdcToZarCents(units, rate.zarPerUsdc), zarPerUsdc: rate.zarPerUsdc, feeBps: fees.topupFeeBps, minFeeZarCents: fees.minFeeZarCents };
  }

  async function withFloatLock<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) throw new HttpError(409, 'Another payment from the float is being sent. Try again in a moment.', 'IN_PROGRESS');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  async function assertFloat(units: bigint) {
    const floatUnits = await usdcBalance(shop.address);
    if (floatUnits < units) {
      const { zarPerUsdc } = await getRate(fallbackZarPerUsdc);
      throw new HttpError(409, `Not enough float. The shop has R${(usdcToZarCents(floatUnits, zarPerUsdc) / 100).toFixed(2)}.`, 'NOT_ENOUGH_FLOAT');
    }
  }

  /** Signs a transfer from the shop's float and submits it via the relayer. */
  async function submitFromShop(to: Address, value: bigint): Promise<Hex> {
    const domain = await getUsdcDomain();
    if (domain.chainId !== CHAIN_ID || domain.verifyingContract !== USDC_ADDRESS) throw new Error('Unexpected USDC domain');
    const message = {
      from: shop.address as Address,
      to,
      value,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + AUTH_VALIDITY_S),
      nonce: toHex(randomBytes(32)),
    };
    const signature = await shop.signTypedData({ domain, types: transferWithAuthorizationTypes, primaryType: 'TransferWithAuthorization', message });
    return verifyAndSubmit(relayer, message, signature, 'Could not sign the payment from the shop.');
  }

  /** Waits for the receipt: true when confirmed, false when it's just slow. Throws if it reverted. */
  async function waitConfirmed(hash: Hex, what: string): Promise<boolean> {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      if (receipt.status !== 'success') throw new HttpError(502, `The ${what} failed on the network. Nothing was sent; please try again.`, 'TX_REVERTED');
      return true;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      return false;
    }
  }

  // ---- Cash top-ups

  /**
   * Customer pays `zarCents` in cash; they receive USDC worth that amount minus the fee
   * (TOPUP_FEE_BPS, at least MIN_FEE_ZAR_CENTS), sent from the shop's float.
   */
  async function topUp(zarCents: number, customer: unknown): Promise<{ topUp: TopUp; confirmed: boolean; float: Float }> {
    if (typeof customer !== 'string' || !isAddress(customer)) throw new HttpError(400, "That isn't a valid customer code.", 'BAD_REQUEST');
    const customerAddress = getAddress(customer);
    if (customerAddress === shop.address) throw new HttpError(400, "That's the shop's own code.", 'BAD_REQUEST');

    return withFloatLock(async () => {
      const { zarPerUsdc } = await getRate(fallbackZarPerUsdc);
      const feeZarCents = feeFor(zarCents, fees.topupFeeBps, fees.minFeeZarCents);
      if (feeZarCents >= zarCents) throw new HttpError(400, `Amount is too small. The fee is at least R${(fees.minFeeZarCents / 100).toFixed(2)}.`, 'BAD_REQUEST');
      const usdcAmount = zarCentsToUsdc(zarCents - feeZarCents, zarPerUsdc);
      if (usdcAmount === 0n) throw new HttpError(400, 'Amount is too small.', 'BAD_REQUEST');
      await assertFloat(usdcAmount);

      const hash = await submitFromShop(customerAddress, usdcAmount);
      const confirmed = await waitConfirmed(hash, 'top-up');

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
    });
  }

  // ---- Refunds

  /**
   * Sends a PAID order's full USDC amount back to its payer from the float.
   * The refund tx hash is saved on the order as soon as it's submitted, so a second
   * refund is refused even if the first is still confirming.
   */
  async function refund(orderId: string): Promise<{ order: Order; confirmed: boolean }> {
    if (refundsInFlight.has(orderId)) throw new HttpError(409, 'This refund is already being sent.', 'IN_PROGRESS');
    refundsInFlight.add(orderId);
    try {
      return await withFloatLock(async () => {
        const order = await repo.get(orderId);
        if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
        if (order.status === 'REFUNDED') throw new HttpError(409, 'This order has already been refunded.', 'ALREADY_REFUNDED');
        if (order.status !== 'PAID') throw new HttpError(409, 'Only paid orders can be refunded.', 'NOT_PAID');
        // The customer already has the cash, so sending the USDC back would pay them twice.
        if (order.type === 'cashout') throw new HttpError(409, "Cash-outs can't be refunded.", 'NOT_REFUNDABLE');
        if (order.refundTxHash) throw new HttpError(409, 'A refund for this order is already being confirmed.', 'IN_PROGRESS');
        if (!order.payer || !isAddress(order.payer)) throw new HttpError(409, "This order has no payer to refund.", 'NO_PAYER');

        const value = BigInt(order.usdcAmount);
        await assertFloat(value);

        const hash = await submitFromShop(getAddress(order.payer), value);
        const marked = await repo.transition(order.id, ['PAID'], { refundTxHash: hash });
        if (!marked) console.error(`Order ${order.id}: refund ${hash} sent but the order was no longer PAID`);

        let confirmed: boolean;
        try {
          confirmed = await waitConfirmed(hash, 'refund');
        } catch (err) {
          await repo.transition(order.id, ['PAID'], { refundTxHash: null });
          throw err;
        }
        const updated = confirmed ? await repo.transition(order.id, ['PAID'], { status: 'REFUNDED' }) : null;
        console.log(`Refund: order ${order.id} R${(order.zarCents / 100).toFixed(2)} -> ${order.payer} (${hash})${confirmed ? '' : ' [confirming]'}`);
        return { order: updated ?? (await repo.get(order.id)) ?? order, confirmed };
      });
    } finally {
      refundsInFlight.delete(orderId);
    }
  }

  /** Settles refunds whose receipt wasn't seen when they were sent (called by the background sweep). */
  async function reconcileRefunds() {
    for (const order of await repo.listRefundsInFlight()) {
      if (refundsInFlight.has(order.id) || !order.refundTxHash) continue;
      const hash = order.refundTxHash as Hex;
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        if (receipt.status === 'success') {
          await repo.transition(order.id, ['PAID'], { status: 'REFUNDED' });
          console.log(`Order ${order.id}: refund confirmed late (${hash})`);
        } else {
          await repo.transition(order.id, ['PAID'], { refundTxHash: null });
          console.log(`Order ${order.id}: refund reverted, cleared (${hash})`);
        }
      } catch (err) {
        // No receipt yet: leave it marked. Clearing a refund that might still be mined could allow a double refund.
        if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
      }
    }
  }

  return { checkPin, getFloat, topUp, refund, reconcileRefunds };
}

export type ShopOwner = ReturnType<typeof createShopOwner>;
