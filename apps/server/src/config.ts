import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnv, requirePrivateKey } from './env';

export interface Config {
  port: number;
  shopName: string;
  shopAddress: Address;
  relayerKey: Hex;
  orderTtlSeconds: number;
  fallbackZarPerUsdc: number;
  topupFeeBps: number;
  ownerPin: string;
  /** PUBLIC_URL if set; otherwise the LAN address is worked out on each request (see network.ts). */
  publicUrlOverride?: string;
  supabase?: { url: string; key: string };
}

function num(name: string, fallback: number, check: (n: number) => boolean): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!check(n)) throw new Error(`${name} has an invalid value "${raw}".`);
  return n;
}

export function loadConfig(): Config {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (supabaseUrl && !supabaseKey) {
    throw new Error('SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is empty. Set both, or clear SUPABASE_URL to use the in-memory store.');
  }

  const port = num('PORT', 3000, (n) => Number.isInteger(n) && n > 0 && n < 65536);
  const configuredUrl = process.env.PUBLIC_URL?.trim();
  if (configuredUrl && !/^https?:\/\/[^/]+/.test(configuredUrl)) throw new Error(`PUBLIC_URL must start with http:// or https:// (got "${configuredUrl}").`);

  return {
    port,
    shopName: process.env.SHOP_NAME?.trim() || "Mama Thoko's Spaza",
    shopAddress: privateKeyToAccount(requirePrivateKey('SHOP_PRIVATE_KEY')).address,
    relayerKey: requirePrivateKey('RELAYER_PRIVATE_KEY'),
    orderTtlSeconds: num('ORDER_TTL_SECONDS', 60, (n) => Number.isInteger(n) && n >= 10),
    fallbackZarPerUsdc: num('FALLBACK_ZAR_PER_USDC', 18.5, (n) => Number.isFinite(n) && n > 0),
    topupFeeBps: num('TOPUP_FEE_BPS', 200, (n) => Number.isInteger(n) && n >= 0 && n < 10_000),
    ownerPin: process.env.OWNER_PIN?.trim() || '1234',
    publicUrlOverride: configuredUrl || undefined,
    supabase: supabaseUrl && supabaseKey ? { url: supabaseUrl, key: supabaseKey } : undefined,
  };
}
