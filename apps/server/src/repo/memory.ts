import type { Order, OrderStatus, TopUp, User } from '@kasi-rails/shared';
import { AddressRegisteredError, UsernameTakenError, type OrderPatch, type OrderRepo } from './types';

function applyPatch(order: Order, patch: OrderPatch): Order {
  const next: Order = { ...order };
  if (patch.status !== undefined) next.status = patch.status;
  for (const key of ['payer', 'txHash', 'refundTxHash'] as const) {
    const value = patch[key];
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next;
}

/** Process-local store; data is lost on restart. */
export class MemoryOrderRepo implements OrderRepo {
  readonly kind = 'memory';
  private orders = new Map<string, Order>();
  private topUps: TopUp[] = [];
  private users = new Map<string, User>();

  async check() {}

  async create(order: Order) {
    if (this.orders.has(order.id)) throw new Error(`Order ${order.id} already exists`);
    this.orders.set(order.id, { ...order });
  }

  async get(id: string) {
    const order = this.orders.get(id);
    return order ? { ...order } : null;
  }

  async transition(id: string, from: OrderStatus[], patch: OrderPatch) {
    const order = this.orders.get(id);
    if (!order || !from.includes(order.status)) return null;
    const next = applyPatch(order, patch);
    this.orders.set(id, next);
    return { ...next };
  }

  async listCreatedSince(since: Date) {
    const t = since.getTime();
    return [...this.orders.values()]
      .filter((o) => Date.parse(o.createdAt) >= t)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((o) => ({ ...o }));
  }

  async expireDue(now: Date) {
    const expired: Order[] = [];
    for (const order of this.orders.values()) {
      if (order.status === 'PENDING' && !order.txHash && Date.parse(order.expiresAt) <= now.getTime()) {
        order.status = 'EXPIRED';
        expired.push({ ...order });
      }
    }
    return expired;
  }

  async listSubmitted() {
    return [...this.orders.values()].filter((o) => o.status === 'PENDING' && o.txHash).map((o) => ({ ...o }));
  }

  async listRefundsInFlight() {
    return [...this.orders.values()].filter((o) => o.status === 'PAID' && o.refundTxHash).map((o) => ({ ...o }));
  }

  async createTopUp(topUp: TopUp) {
    this.topUps.push({ ...topUp });
  }

  async listTopUpsSince(since: Date) {
    return this.topUps
      .filter((t) => Date.parse(t.createdAt) >= since.getTime())
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((t) => ({ ...t }));
  }

  async createUser(user: User) {
    if (this.users.has(user.username)) throw new UsernameTakenError(user.username);
    if ([...this.users.values()].some((u) => u.address === user.address)) throw new AddressRegisteredError(user.address);
    this.users.set(user.username, { ...user });
  }

  async getUserByUsername(username: string) {
    const user = this.users.get(username);
    return user ? { ...user } : null;
  }

  async getUsersByAddresses(addresses: string[]) {
    const wanted = new Set(addresses);
    return [...this.users.values()].filter((u) => wanted.has(u.address)).map((u) => ({ ...u }));
  }

  async getUserByAddress(address: string) {
    const user = [...this.users.values()].find((u) => u.address === address);
    return user ? { ...user } : null;
  }
}

