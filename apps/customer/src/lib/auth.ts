import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { sha256, stringToBytes, toHex, type Hex } from 'viem';
import { normalizeUsername, registrationMessage } from '@kasi-rails/shared';

import { API_URL, ApiError } from './api';
import { getAddress, signMessage } from './wallet';

// Everything here stays on the phone, in secure storage. The server only ever sees the username.
const USERNAME_KEY = 'kasi-rails.username';
const PIN_KEY = 'kasi-rails.pin';
const ATTEMPTS_KEY = 'kasi-rails.pin-attempts';
const BIOMETRICS_KEY = 'kasi-rails.biometrics';

const PIN_ITERATIONS = 5_000;
const FAILS_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

// ---- Username (registered on the server, remembered on the phone)

export async function getLocalUsername(): Promise<string | null> {
  return SecureStore.getItemAsync(USERNAME_KEY);
}

/** If this wallet registered before but the phone forgot the name, fetch it back from the server. */
export async function restoreUsername(): Promise<string | null> {
  try {
    const address = await getAddress();
    const res = await fetch(`${API_URL}/users/by-address/${address}`);
    if (!res.ok) return null;
    const { username } = (await res.json()) as { username: string };
    await SecureStore.setItemAsync(USERNAME_KEY, username);
    return username;
  } catch {
    return null;
  }
}

export async function checkUsername(input: string): Promise<{ username: string; available: boolean; reason?: string }> {
  const res = await fetch(`${API_URL}/users/check/${encodeURIComponent(normalizeUsername(input))}`);
  if (!res.ok) throw new ApiError("Couldn't check that username.", res.status);
  return res.json();
}

/** Registers @username for this phone's wallet, proven by a signature from the wallet. */
export async function registerUsername(input: string): Promise<string> {
  const username = normalizeUsername(input);
  const address = await getAddress();
  const issuedAt = new Date().toISOString();
  const signature = await signMessage(registrationMessage(username, address, issuedAt));
  let res: Response;
  try {
    res = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, address, issuedAt, signature }),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet and try again.", 0, 'NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'Could not create your account.', res.status, body.code);
  await SecureStore.setItemAsync(USERNAME_KEY, body.username);
  return body.username;
}

// ---- App PIN (hashed with a random salt; never stored as typed)

interface StoredPin {
  salt: Hex;
  hash: Hex;
  length: number;
}

function hashPin(pin: string, salt: Hex): Hex {
  let h = sha256(stringToBytes(`${salt}:${pin}`));
  for (let i = 1; i < PIN_ITERATIONS; i++) h = sha256(h);
  return h;
}

async function readPin(): Promise<StoredPin | null> {
  const raw = await SecureStore.getItemAsync(PIN_KEY);
  return raw ? (JSON.parse(raw) as StoredPin) : null;
}

export async function hasPin(): Promise<boolean> {
  return (await readPin()) !== null;
}

export async function getPinLength(): Promise<number> {
  return (await readPin())?.length ?? 4;
}

export async function setPin(pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const stored: StoredPin = { salt, hash: hashPin(pin, salt), length: pin.length };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(stored));
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

interface Attempts {
  fails: number;
  lockedUntil: number;
}

async function readAttempts(): Promise<Attempts> {
  const raw = await SecureStore.getItemAsync(ATTEMPTS_KEY);
  return raw ? (JSON.parse(raw) as Attempts) : { fails: 0, lockedUntil: 0 };
}

/** Milliseconds until PIN entry is allowed again (0 if allowed now). */
export async function pinLockoutRemaining(): Promise<number> {
  return Math.max(0, (await readAttempts()).lockedUntil - Date.now());
}

export type PinResult = { ok: true } | { ok: false; lockedForMs: number; triesLeft: number };

/** Checks the PIN. Repeated wrong PINs lock entry for a while, doubling each time. */
export async function verifyPin(pin: string): Promise<PinResult> {
  const attempts = await readAttempts();
  if (attempts.lockedUntil > Date.now()) return { ok: false, lockedForMs: attempts.lockedUntil - Date.now(), triesLeft: 0 };

  const stored = await readPin();
  if (stored && hashPin(pin, stored.salt) === stored.hash) {
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
    return { ok: true };
  }

  const fails = attempts.fails + 1;
  let lockedUntil = 0;
  if (fails % FAILS_BEFORE_LOCKOUT === 0) {
    const rounds = fails / FAILS_BEFORE_LOCKOUT;
    lockedUntil = Date.now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** (rounds - 1));
  }
  await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify({ fails, lockedUntil }));
  return { ok: false, lockedForMs: Math.max(0, lockedUntil - Date.now()), triesLeft: FAILS_BEFORE_LOCKOUT - (fails % FAILS_BEFORE_LOCKOUT) };
}

/** Clears the failed-attempt counter (after a successful biometric unlock). */
export async function resetPinAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

// ---- Face ID / fingerprint

export interface BiometricInfo {
  available: boolean;
  /** "Face ID", "face unlock" or "fingerprint" */
  label: string;
}

export async function getBiometricInfo(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = face ? (process.env.EXPO_OS === 'ios' ? 'Face ID' : 'face unlock') : 'fingerprint';
    return { available: hardware && enrolled, label };
  } catch {
    return { available: false, label: 'fingerprint' };
  }
}

export async function isBiometricsEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRICS_KEY)) === '1';
}

export async function setBiometricsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRICS_KEY, enabled ? '1' : '0');
}

/** Shows the system Face ID / fingerprint prompt. The PIN is the fallback, so the device passcode is not offered. */
export async function authenticateBiometric(prompt = 'Unlock Kasi Rails'): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
      fallbackLabel: '',
    });
    return result.success;
  } catch {
    return false;
  }
}
