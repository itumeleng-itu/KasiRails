import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Order, OrderStatus, OrderType, TopUp, User } from '@kasi-rails/shared';
import { AddressRegisteredError, UsernameTakenError, type OrderPatch, type OrderRepo } from './types';

interface OrderRow {
  id: string;
  type: OrderType;
  zar_cents: number;
  usdc_amount: number | string;
  status: OrderStatus;
  payer: string | null;
  tx_hash: string | null;
  refund_tx_hash: string | null;
  created_at: string;
  expires_at: string;
}

interface TopUpRow {
  id: string;
  zar_cents: number;
  fee_zar_cents: number;
  usdc_amount: number | string;
  customer_address: string;
  tx_hash: string;
  created_at: string;
}

interface UserRow {
  username: string;
  address: string;
  created_at: string;
}

const toIso = (ts: string) => new Date(ts).toISOString();

const userFromRow = (r: UserRow): User => ({ username: r.username, address: r.address, createdAt: toIso(r.created_at) });

function fromRow(row: OrderRow): Order {
  const order: Order = {
    id: row.id,
    type: row.type,
    zarCents: row.zar_cents,
    usdcAmount: String(row.usdc_amount),
    status: row.status,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
  if (row.payer) order.payer = row.payer;
  if (row.tx_hash) order.txHash = row.tx_hash;
  if (row.refund_tx_hash) order.refundTxHash = row.refund_tx_hash;
  return order;
}

function patchToRow(patch: OrderPatch): Partial<OrderRow> {
  const row: Partial<OrderRow> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.payer !== undefined) row.payer = patch.payer;
  if (patch.txHash !== undefined) row.tx_hash = patch.txHash;
  if (patch.refundTxHash !== undefined) row.refund_tx_hash = patch.refundTxHash;
  return row;
}

function unwrap<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`Supabase ${what} failed: ${result.error.message}`);
  return result.data;
}

export class SupabaseOrderRepo implements OrderRepo {
  readonly kind = 'supabase';
  private db: SupabaseClient;

  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async check() {
    // Not a HEAD request: those report success even when the table is missing.
    for (const table of ['orders', 'topups', 'users']) {
      const { error } = await this.db.from(table).select('*').limit(1);
      if (error?.code === 'PGRST205') {
        throw new Error(`Supabase table "${table}" is missing. Run apps/server/supabase/schema.sql in the Supabase SQL Editor.`);
      }
      if (error) throw new Error(`Supabase check failed: ${error.message}`);
    }
  }

  async create(order: Order) {
    const row: OrderRow = {
      id: order.id,
      type: order.type,
      zar_cents: order.zarCents,
      usdc_amount: order.usdcAmount,
      status: order.status,
      payer: order.payer ?? null,
      tx_hash: order.txHash ?? null,
      refund_tx_hash: order.refundTxHash ?? null,
      created_at: order.createdAt,
      expires_at: order.expiresAt,
    };
    unwrap(await this.db.from('orders').insert(row), 'insert order');
  }

  async get(id: string) {
    const row = unwrap(await this.db.from('orders').select('*').eq('id', id).maybeSingle<OrderRow>(), 'get order');
    return row ? fromRow(row) : null;
  }

  async transition(id: string, from: OrderStatus[], patch: OrderPatch) {
    const row = unwrap(
      await this.db.from('orders').update(patchToRow(patch)).eq('id', id).in('status', from).select('*').maybeSingle<OrderRow>(),
      'update order',
    );
    return row ? fromRow(row) : null;
  }

  async listCreatedSince(since: Date) {
    const rows = unwrap(
      await this.db.from('orders').select('*').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).returns<OrderRow[]>(),
      'list orders',
    );
    return (rows ?? []).map(fromRow);
  }

  async expireDue(now: Date) {
    const rows = unwrap(
      await this.db
        .from('orders')
        .update({ status: 'EXPIRED' })
        .eq('status', 'PENDING')
        .is('tx_hash', null)
        .lte('expires_at', now.toISOString())
        .select('*')
        .returns<OrderRow[]>(),
      'expire orders',
    );
    return (rows ?? []).map(fromRow);
  }

  async listSubmitted() {
    const rows = unwrap(
      await this.db.from('orders').select('*').eq('status', 'PENDING').not('tx_hash', 'is', null).returns<OrderRow[]>(),
      'list submitted orders',
    );
    return (rows ?? []).map(fromRow);
  }

  async createTopUp(t: TopUp) {
    const row: TopUpRow = {
      id: t.id,
      zar_cents: t.zarCents,
      fee_zar_cents: t.feeZarCents,
      usdc_amount: t.usdcAmount,
      customer_address: t.customerAddress,
      tx_hash: t.txHash,
      created_at: t.createdAt,
    };
    unwrap(await this.db.from('topups').insert(row), 'insert top-up');
  }

  async listTopUpsSince(since: Date) {
    const rows = unwrap(
      await this.db.from('topups').select('*').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).returns<TopUpRow[]>(),
      'list top-ups',
    );
    return (rows ?? []).map((r) => ({
      id: r.id,
      zarCents: r.zar_cents,
      feeZarCents: r.fee_zar_cents,
      usdcAmount: String(r.usdc_amount),
      customerAddress: r.customer_address,
      txHash: r.tx_hash,
      createdAt: toIso(r.created_at),
    }));
  }

  async createUser(user: User) {
    const { error } = await this.db.from('users').insert({ username: user.username, address: user.address, created_at: user.createdAt });
    if (!error) return;
    if (error.code === '23505') {
      // Unique violation: which constraint tells us whether the name or the address is taken.
      if (/address/i.test(error.message)) throw new AddressRegisteredError(user.address);
      throw new UsernameTakenError(user.username);
    }
    throw new Error(`Supabase insert user failed: ${error.message}`);
  }

  async getUserByUsername(username: string) {
    const row = unwrap(await this.db.from('users').select('*').eq('username', username).maybeSingle<UserRow>(), 'get user');
    return row ? userFromRow(row) : null;
  }

  async getUserByAddress(address: string) {
    const row = unwrap(await this.db.from('users').select('*').eq('address', address).maybeSingle<UserRow>(), 'get user');
    return row ? userFromRow(row) : null;
  }
}


