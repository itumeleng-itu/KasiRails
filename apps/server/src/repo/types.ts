import type { Order, OrderStatus } from '@kasi-rails/shared';

/** Fields that change after creation. `null` clears an optional field. */
export interface OrderPatch {
  status?: OrderStatus;
  payer?: string | null;
  txHash?: string | null;
  refundTxHash?: string | null;
}

export interface OrderRepo {
  readonly kind: 'memory' | 'supabase';
  /** Throws with a setup hint if the store isn't usable (e.g. tables missing). */
  check(): Promise<void>;
  create(order: Order): Promise<void>;
  get(id: string): Promise<Order | null>;
  /** Applies `patch` only if the order's status is one of `from`. Returns the updated order, or null if it didn't match. */
  transition(id: string, from: OrderStatus[], patch: OrderPatch): Promise<Order | null>;
  /** Orders created at or after `since`, newest first. */
  listCreatedSince(since: Date): Promise<Order[]>;
  /** Marks PENDING orders with no submitted tx and expiresAt <= now as EXPIRED. Returns them. */
  expireDue(now: Date): Promise<Order[]>;
  /** PENDING orders with a submitted tx that hasn't been confirmed yet. */
  listSubmitted(): Promise<Order[]>;
}
