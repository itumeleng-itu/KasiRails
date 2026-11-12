import { createPublicClient, http, type Hex } from 'viem';
import { CHAIN, RPC_URL, USDC_ADDRESS, usdcAbi } from '@kasi-rails/shared';

import { getRate } from './api';

// Balances are public on-chain, so Home can show them even when the shop's server is unreachable.
const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { timeout: 10_000 }) });

const VALR_URL = 'https://api.valr.com/v1/public/USDCZAR/marketsummary';
/** Last resort if neither our server nor VALR answers (matches the server's default). */
const FALLBACK_ZAR_PER_USDC = 18.5;

export function readUsdcBalance(address: Hex): Promise<bigint> {
  return client.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [address] });
}

export interface RateQuote {
  zarPerUsdc: number;
  /** false when we had to fall back to a fixed estimate */
  live: boolean;
}

/** Rand per US dollar: our server first, then VALR directly, then a fixed estimate. */
export async function readRate(): Promise<RateQuote> {
  try {
    const r = await getRate();
    return { zarPerUsdc: r.zarPerUsdc, live: r.source === 'valr' };
  } catch {
    // fall through to VALR
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(VALR_URL, { signal: controller.signal }).finally(() => clearTimeout(timer));
    const price = Number(((await res.json()) as { lastTradedPrice?: string }).lastTradedPrice);
    if (Number.isFinite(price) && price > 0) return { zarPerUsdc: price, live: true };
  } catch {
    // fall through to the fixed estimate
  }
  return { zarPerUsdc: FALLBACK_ZAR_PER_USDC, live: false };
}
