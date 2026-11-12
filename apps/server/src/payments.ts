import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  TransactionReceiptNotFoundError,
  getAddress,
  isAddress,
  isHex,
  parseSignature,
  size,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { USDC_ADDRESS, orderIdToNonce, transferWithAuthorizationTypes, usdcAbi, type Order } from '@kasi-rails/shared';
import { getUsdcDomain, publicClient, type Relayer } from './chain';
import type { OrderRepo } from './repo';

/** How far past the order's expiry the customer's authorization may stay valid. */
const VALID_BEFORE_GRACE_S = 30n;
const RECEIPT_TIMEOUT_MS = 45_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const EXPIRED_MESSAGE = 'This payment request has expired. Ask the shop to charge again.';

export interface PayBody {
  from?: unknown;
  validAfter?: unknown;
  validBefore?: unknown;
  signature?: unknown;
  // Optional: if sent, they must match what the server derives from the order.
  to?: unknown;
  value?: unknown;
  nonce?: unknown;
}

function toUint(value: unknown, field: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new HttpError(400, `${field} must be a non-negative integer.`, 'BAD_REQUEST');
}

function assertPayable(order: Order) {
  if (order.status === 'PAID') throw new HttpError(409, 'This order has already been paid.', 'ALREADY_PAID');
  if (order.status === 'REFUNDED') throw new HttpError(409, 'This order was refunded.', 'REFUNDED');
  if (order.status === 'EXPIRED') throw new HttpError(409, EXPIRED_MESSAGE, 'EXPIRED');
  if (order.txHash) throw new HttpError(409, 'A payment for this order is already being confirmed.', 'IN_PROGRESS');
}

/** Turns simulation/submission failures into messages a customer can act on. */
function toPaymentError(err: unknown): HttpError {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof InsufficientFundsError)) {
      return new HttpError(503, "The shop's payment service is temporarily unavailable. Please try again later.", 'RELAYER_OUT_OF_GAS');
    }
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const reason = (revert instanceof ContractFunctionRevertedError ? revert.reason : undefined) ?? err.shortMessage;
    const r = reason.toLowerCase();
    if (r.includes('exceeds balance')) return new HttpError(402, "You don't have enough money to pay this.", 'INSUFFICIENT_FUNDS');
    if (r.includes('invalid signature')) return new HttpError(400, 'The payment signature is not valid for this order.', 'BAD_SIGNATURE');
    if (r.includes('authorization is used')) return new HttpError(409, 'This payment has already been made.', 'ALREADY_PAID');
    if (r.includes('authorization is expired')) return new HttpError(409, EXPIRED_MESSAGE, 'EXPIRED');
    if (r.includes('not yet valid')) return new HttpError(400, 'The payment authorization is not valid yet.', 'BAD_REQUEST');
    if (r.includes('blacklisted')) return new HttpError(403, 'This account cannot send USDC.', 'BLOCKED');
    return new HttpError(502, `Could not submit the payment: ${reason}`, 'SUBMIT_FAILED');
  }
  return new HttpError(502, 'Could not submit the payment. Please try again.', 'SUBMIT_FAILED');
}

export function createPayments(deps: { repo: OrderRepo; relayer: Relayer; shopAddress: Address }) {
  const { repo, relayer, shopAddress } = deps;
  /** Orders with a payment being handled by this process. */
  const inFlight = new Set<string>();

  /**
   * Validates a signed authorization against the order, submits it via the relayer and
   * waits for the receipt. `confirmed: false` means it was submitted but the receipt
   * didn't arrive in time; the sweep will finish it.
   */
  async function pay(orderId: string, body: PayBody): Promise<{ order: Order; confirmed: boolean }> {
    if (inFlight.has(orderId)) throw new HttpError(409, 'This payment is already being processed.', 'IN_PROGRESS');
    inFlight.add(orderId);
    try {
      const order = await repo.get(orderId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      assertPayable(order);

      const nowS = BigInt(Math.floor(Date.now() / 1000));
      const expiresS = BigInt(Math.floor(Date.parse(order.expiresAt) / 1000));
      if (nowS >= expiresS) {
        await repo.transition(order.id, ['PENDING'], { status: 'EXPIRED' });
        throw new HttpError(409, EXPIRED_MESSAGE, 'EXPIRED');
      }

      if (typeof body.from !== 'string' || !isAddress(body.from)) throw new HttpError(400, 'from must be an address.', 'BAD_REQUEST');
      if (typeof body.signature !== 'string' || !isHex(body.signature) || size(body.signature) !== 65) {
        throw new HttpError(400, 'signature must be a 65-byte hex string.', 'BAD_REQUEST');
      }
      const from = getAddress(body.from);
      const signature = body.signature as Hex;
      const validAfter = toUint(body.validAfter, 'validAfter');
      const validBefore = toUint(body.validBefore, 'validBefore');
      if (validAfter >= nowS) throw new HttpError(400, 'validAfter must be in the past (use 0).', 'BAD_REQUEST');
      if (validBefore <= nowS) throw new HttpError(409, EXPIRED_MESSAGE, 'EXPIRED');
      if (validBefore > expiresS + VALID_BEFORE_GRACE_S) {
        throw new HttpError(400, `validBefore must be no later than the order's expiry plus ${VALID_BEFORE_GRACE_S}s.`, 'BAD_REQUEST');
      }

      const message = {
        from,
        to: shopAddress,
        value: BigInt(order.usdcAmount),
        validAfter,
        validBefore,
        nonce: orderIdToNonce(order.id),
      };
      if (body.to !== undefined && (typeof body.to !== 'string' || !isAddress(body.to) || getAddress(body.to) !== shopAddress)) {
        throw new HttpError(400, "to must be the shop's address.", 'BAD_REQUEST');
      }
      if (body.value !== undefined && toUint(body.value, 'value') !== message.value) {
        throw new HttpError(400, 'value does not match the order amount.', 'BAD_REQUEST');
      }
      if (body.nonce !== undefined && (typeof body.nonce !== 'string' || body.nonce.toLowerCase() !== message.nonce)) {
        throw new HttpError(400, 'nonce does not match this order.', 'BAD_REQUEST');
      }

      const domain = await getUsdcDomain();
      const valid = await verifyTypedData({
        address: from,
        domain,
        types: transferWithAuthorizationTypes,
        primaryType: 'TransferWithAuthorization',
        message,
        signature,
      }).catch(() => false);
      if (!valid) throw new HttpError(400, 'The payment signature is not valid for this order.', 'BAD_SIGNATURE');

      const { r, s, v, yParity } = parseSignature(signature);
      let hash: Hex;
      try {
        const { request } = await publicClient.simulateContract({
          account: relayer.account,
          address: USDC_ADDRESS,
          abi: usdcAbi,
          functionName: 'transferWithAuthorization',
          args: [from, shopAddress, message.value, validAfter, validBefore, message.nonce, v !== undefined ? Number(v) : yParity + 27, r, s],
        });
        hash = await relayer.writeContract(request);
      } catch (err) {
        throw toPaymentError(err);
      }

      // Record the tx straight away so a restart or timeout can still reconcile it.
      const submitted = (await repo.transition(order.id, ['PENDING', 'EXPIRED'], { payer: from, txHash: hash })) ?? order;

      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      } catch {
        return { order: submitted, confirmed: false };
      }
      if (receipt.status !== 'success') {
        await repo.transition(order.id, ['PENDING', 'EXPIRED'], { payer: null, txHash: null });
        throw new HttpError(502, 'The payment failed on the network. Nothing was taken; please try again.', 'TX_REVERTED');
      }
      // The transfer happened on-chain, so it's PAID even if the order expired meanwhile.
      const paid = await repo.transition(order.id, ['PENDING', 'EXPIRED'], { status: 'PAID', payer: from, txHash: hash });
      return { order: paid ?? (await repo.get(order.id)) ?? submitted, confirmed: true };
    } finally {
      inFlight.delete(orderId);
    }
  }

  /** Confirms or clears a submitted tx whose receipt wasn't seen by pay(). */
  async function reconcile(order: Order) {
    const hash = order.txHash as Hex;
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      if (receipt.status === 'success') {
        await repo.transition(order.id, ['PENDING', 'EXPIRED'], { status: 'PAID' });
        console.log(`Order ${order.id}: late confirmation, now PAID (${hash})`);
      } else {
        await repo.transition(order.id, ['PENDING'], { payer: null, txHash: null });
        console.log(`Order ${order.id}: tx reverted, payment cleared (${hash})`);
      }
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
      // The authorization can't be mined after validBefore (<= expiresAt + grace); give up after that.
      const deadline = Date.parse(order.expiresAt) + (Number(VALID_BEFORE_GRACE_S) + 120) * 1000;
      if (Date.now() > deadline) {
        await repo.transition(order.id, ['PENDING'], { status: 'EXPIRED', payer: null, txHash: null });
        console.log(`Order ${order.id}: tx never mined, marked EXPIRED (${hash})`);
      }
    }
  }

  async function sweep() {
    const expired = await repo.expireDue(new Date());
    for (const o of expired) console.log(`Order ${o.id}: EXPIRED`);
    for (const order of await repo.listSubmitted()) {
      if (inFlight.has(order.id)) continue;
      await reconcile(order).catch((err) => console.error(`Reconcile ${order.id} failed:`, err instanceof Error ? err.message : err));
    }
  }

  return { pay, sweep };
}

export type Payments = ReturnType<typeof createPayments>;
