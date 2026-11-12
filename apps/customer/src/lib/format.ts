/** 8500 -> "R85.00", 125000 -> "R1 250.00" */
export function formatRand(cents: number): string {
  const rands = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, '0');
  return `R${String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${c}`;
}

/** USDC base units -> "US$4.59" (rounded down to cents). */
export function formatDollars(units: string | bigint): string {
  const cents = BigInt(units) / 10_000n;
  return `US$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
