import type { Config } from '../config';
import { MemoryOrderRepo } from './memory';
import { SupabaseOrderRepo } from './supabase';
import type { OrderRepo } from './types';

export type { OrderPatch, OrderRepo } from './types';

export function createOrderRepo(config: Config): OrderRepo {
  return config.supabase ? new SupabaseOrderRepo(config.supabase.url, config.supabase.key) : new MemoryOrderRepo();
}
