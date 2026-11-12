const VALR_URL = 'https://api.valr.com/v1/public/USDCZAR/marketsummary';
const TIMEOUT_MS = 2_000;
const CACHE_MS = 15_000;

export interface RateQuote {
  zarPerUsdc: number;
  source: 'valr' | 'fallback';
}

let cached: { quote: RateQuote; at: number } | undefined;

/** USDC/ZAR from VALR's last traded price, cached briefly; falls back to the configured rate. */
export async function getRate(fallbackZarPerUsdc: number): Promise<RateQuote> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.quote;

  let quote: RateQuote;
  try {
    const res = await fetch(VALR_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`VALR returned ${res.status}`);
    const body = (await res.json()) as { lastTradedPrice?: string };
    const price = Number(body.lastTradedPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('VALR returned no lastTradedPrice');
    quote = { zarPerUsdc: price, source: 'valr' };
  } catch (err) {
    console.warn(`Rate: using fallback ${fallbackZarPerUsdc} (${err instanceof Error ? err.message : err})`);
    quote = { zarPerUsdc: fallbackZarPerUsdc, source: 'fallback' };
  }
  cached = { quote, at: Date.now() };
  return quote;
}
