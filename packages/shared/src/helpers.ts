import { keccak256, stringToBytes, type Hex } from 'viem';

/** Rates are carried as fixed-point integers with this many decimals to avoid float drift. */
const RATE_SCALE = 1_000_000n;

/**
 * Converts rand cents to USDC base units (6 decimals), rounded down.
 * usdc = (zarCents / 100) / zarPerUsdc * 1e6
 */
export function zarCentsToUsdc(zarCents: number, zarPerUsdc: number): bigint {
  if (!Number.isSafeInteger(zarCents) || zarCents < 0) {
    throw new Error(`zarCents must be a non-negative integer, got ${zarCents}`);
  }
  if (!Number.isFinite(zarPerUsdc) || zarPerUsdc <= 0) {
    throw new Error(`zarPerUsdc must be a positive number, got ${zarPerUsdc}`);
  }
  const rate = BigInt(Math.round(zarPerUsdc * Number(RATE_SCALE)));
  // zarCents * 1e4 gives USDC units at a rate of 1; scale up by RATE_SCALE to divide by the scaled rate.
  return (BigInt(zarCents) * 10_000n * RATE_SCALE) / rate;
}

/** Converts USDC base units to rand cents, rounded down. */
export function usdcToZarCents(usdc: bigint, zarPerUsdc: number): number {
  if (!Number.isFinite(zarPerUsdc) || zarPerUsdc <= 0) {
    throw new Error(`zarPerUsdc must be a positive number, got ${zarPerUsdc}`);
  }
  const rate = BigInt(Math.round(zarPerUsdc * Number(RATE_SCALE)));
  return Number((usdc * rate) / (10_000n * RATE_SCALE));
}

/** EIP-3009 nonce for an order: keccak256 of the UTF-8 order id. */
export function orderIdToNonce(orderId: string): Hex {
  return keccak256(stringToBytes(orderId));
}

/** Usernames are 3-20 characters: lowercase letters, digits and underscores. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Lowercases, trims and drops a leading "@". */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** The exact message a wallet signs to register a username. */
export function registrationMessage(username: string, address: string, issuedAt: string): string {
  return `Kasi Rails registration\nUsername: @${username}\nAddress: ${address}\nIssued at: ${issuedAt}`;
}
