import { getAddress, type Address } from 'viem';
import { USDC_ADDRESS, usdcToZarCents } from '@kasi-rails/shared';

const BLOCKSCOUT_API = 'https://base-sepolia.blockscout.com/api/v2';
const TIMEOUT_MS = 8_000;
const CACHE_MS = 5_000;

export interface HistoryItem {
  txHash: string;
  direction: 'in' | 'out';
  counterparty: string;
  /** Set when the counterparty is a known shop. */
  label?: string;
  /** Set when the counterparty is a registered Kasi Rails user. */
  username?: string;
  usdcAmount: string;
  /** Rand value at today's rate (not the rate at the time). */
  zarCents: number;
  timestamp: string;
}

interface BlockscoutTransfer {
  transaction_hash: string;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  total: { value: string };
  token: { address?: string; address_hash?: string };
}

const cache = new Map<string, { at: number; items: Omit<HistoryItem, 'zarCents'>[] }>();

/** USDC transfers in and out of `address`, newest first, from Blockscout's public API. */
export async function getHistory(
  address: Address,
  opts: { zarPerUsdc: number; knownShops: Record<string, string> },
): Promise<HistoryItem[]> {
  let entry = cache.get(address);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const url = `${BLOCKSCOUT_API}/addresses/${address}/token-transfers?type=ERC-20&token=${USDC_ADDRESS}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return []; // address never seen on-chain
    if (!res.ok) throw new Error(`Blockscout returned ${res.status}`);
    const body = (await res.json()) as { items?: BlockscoutTransfer[] };

    const items = (body.items ?? [])
      .filter((t) => (t.token.address ?? t.token.address_hash ?? '').toLowerCase() === USDC_ADDRESS.toLowerCase())
      .map((t) => {
        const from = getAddress(t.from.hash);
        const to = getAddress(t.to.hash);
        const direction: 'in' | 'out' = to === address ? 'in' : 'out';
        const counterparty = direction === 'in' ? from : to;
        return { txHash: t.transaction_hash, direction, counterparty, usdcAmount: t.total.value, timestamp: t.timestamp };
      });
    entry = { at: Date.now(), items };
    cache.set(address, entry);
  }

  return entry.items.map((item) => {
    const label = opts.knownShops[item.counterparty];
    return { ...item, ...(label ? { label } : {}), zarCents: usdcToZarCents(BigInt(item.usdcAmount), opts.zarPerUsdc) };
  });
}
