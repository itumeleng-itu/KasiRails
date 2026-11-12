import Constants from 'expo-constants';
import type { Order } from '@kasi-rails/shared';
import { getAddress, isAddress, type Hex } from 'viem';
import type { TransferAuthorization, UsdcDomain } from './wallet';

const SERVER_PORT = 3000;

/**
 * Default server, used for the balance. Payments use the server named in the shop's QR code.
 * EXPO_PUBLIC_API_URL wins if set; otherwise, in development, use the computer Expo is served
 * from (the server runs there too), so switching Wi-Fi networks needs no config change.
 */
function defaultApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:${SERVER_PORT}` : '';
}

export const API_URL = defaultApiUrl();

const TIMEOUT_MS = 15_000;
const PAY_TIMEOUT_MS = 70_000; // the server waits up to ~45s for the network to confirm

export type ShopOrder = Order & { shopName: string; shopAddress: `0x${string}` };

export interface Balance {
  address: string;
  usdcAmount: string;
  usdc: string;
  zarCents: number;
  zarPerUsdc: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; body: T }> {
  if (!base) throw new ApiError('The app is not set up yet (no server address).', 0, 'NO_API');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(`Can't reach the shop's server (${base}). Check that you're on the same network and try again.`, 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status, body.code);
  return { status: res.status, body: body as T };
}

export async function getBalance(address: string, api = API_URL): Promise<Balance> {
  return (await request<Balance>(api, `/balance/${address}`)).body;
}

export async function getOrder(api: string, orderId: string): Promise<ShopOrder> {
  return (await request<ShopOrder>(api, `/orders/${encodeURIComponent(orderId)}`)).body;
}

export async function getUsdcDomain(api: string): Promise<UsdcDomain> {
  return (await request<UsdcDomain>(api, '/usdc-domain')).body;
}

/** Returns the order and whether the network has confirmed it yet (HTTP 200 vs 202). */
export async function payOrder(api: string, orderId: string, auth: TransferAuthorization): Promise<{ order: ShopOrder; confirmed: boolean }> {
  const { status, body } = await request<ShopOrder>(
    api,
    `/orders/${encodeURIComponent(orderId)}/pay`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(auth) },
    PAY_TIMEOUT_MS,
  );
  return { order: body, confirmed: status === 200 };
}

export interface HistoryItem {
  txHash: string;
  direction: 'in' | 'out';
  counterparty: string;
  label?: string;
  usdcAmount: string;
  zarCents: number;
  timestamp: string;
}

export async function getHistory(address: string): Promise<HistoryItem[]> {
  return (await request<{ items: HistoryItem[] }>(API_URL, `/history/${address}`)).body.items;
}

export async function getRate(api = API_URL): Promise<{ zarPerUsdc: number; source: 'valr' | 'fallback' }> {
  return (await request<{ zarPerUsdc: number; source: 'valr' | 'fallback' }>(api, '/rate')).body;
}

export type Scan = { kind: 'order'; orderId: string; api: string } | { kind: 'address'; address: Hex };

/** Recognises a till QR or a plain Receive code. */
export function parseScan(data: string): Scan | null {
  const text = data.trim();
  const plain = text.replace(/^ethereum:/i, '').split(/[@?]/)[0];
  if (isAddress(plain)) return { kind: 'address', address: getAddress(plain) };
  try {
    const parsed = JSON.parse(text);
    if (parsed?.kasiRails !== 1) return null;
    if (typeof parsed.orderId === 'string' && parsed.orderId) {
      let api = typeof parsed.api === 'string' && /^https?:\/\//.test(parsed.api) ? parsed.api.replace(/\/+$/, '') : API_URL;
      // "localhost" in the QR means the till's computer, which this phone can't reach by that name.
      if (/^https?:\/\/(localhost|127\.|\[::1\])/i.test(api) && API_URL) api = API_URL;
      return { kind: 'order', orderId: parsed.orderId, api };
    }
  } catch {
    // not JSON
  }
  return null;
}
