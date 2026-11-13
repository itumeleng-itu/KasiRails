import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { sha256, stringToBytes, toHex, type Hex } from 'viem';
import { normalizeUsername, registrationMessage } from '@kasi-rails/shared';

import { completeSignup, getPendingSigner, settingKey, type AccountInfo } from './accounts';
import { API_URL, ApiError } from './api';

// PINs and settings stay on the phone, per account. The server only ever sees usernames and addresses.

const PIN_ITERATIONS = 5_000;
const FAILS_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

// ---- Sign-up: register a username for a new wallet

export async function checkUsername(input: string): Promise<{ username: string; available: boolean; reason?: string }> {
  const res = await fetch(`${API_URL}/users/check/${encodeURIComponent(normalizeUsername(input))}`);
  if (!res.ok) throw new ApiError("Couldn't check that username.", res.status);
  return res.json();
}

/** If the sign-up wallet was already registered (e.g. sign-up was interrupted), finish it with the existing name. */
export async function resumeSignup(): Promise<AccountInfo | null> {
  try {
    const { address } = await getPendingSigner();
    const res = await fetch(`${API_URL}/users/by-address/${address}`);
    if (!res.ok) return null;
    const { username } = (await res.json()) as { username: string };
    return completeSignup(username);
  } catch {
    return null;
  }
}

/** Registers @username for a new wallet (proven by its signature) and saves it as an account on this phone. */
export async function signUp(input: string): Promise<AccountInfo> {
  const username = normalizeUsername(input);
  const signer = await getPendingSigner();
  const issuedAt = new Date().toISOString();
  const signature = await signer.signMessage({ message: registrationMessage(username, signer.address, issuedAt) });
  let res: Response;
  try {
    res = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, address: signer.address, issuedAt, signature }),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet and try again.", 0, 'NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'Could not create your account.', res.status, body.code);
  return completeSignup(body.username);
}

// ---- PIN (salted, iterated hash; never stored as typed)

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

async function readPin(id: string): Promise<StoredPin | null> {
  const raw = await SecureStore.getItemAsync(settingKey(id, 'pin'));
  return raw ? (JSON.parse(raw) as StoredPin) : null;
}

export async function hasPin(id: string): Promise<boolean> {
  return (await readPin(id)) !== null;
}

export async function getPinLength(id: string): Promise<number> {
  return (await readPin(id))?.length ?? 4;
}

export async function setPin(id: string, pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const stored: StoredPin = { salt, hash: hashPin(pin, salt), length: pin.length };
  await SecureStore.setItemAsync(settingKey(id, 'pin'), JSON.stringify(stored));
  await SecureStore.deleteItemAsync(settingKey(id, 'pin-attempts'));
}

interface Attempts {
  fails: number;
  lockedUntil: number;
}

async function readAttempts(id: string): Promise<Attempts> {
  const raw = await SecureStore.getItemAsync(settingKey(id, 'pin-attempts'));
  return raw ? (JSON.parse(raw) as Attempts) : { fails: 0, lockedUntil: 0 };
}

/** Milliseconds until PIN entry is allowed again (0 if allowed now). */
export async function pinLockoutRemaining(id: string): Promise<number> {
  return Math.max(0, (await readAttempts(id)).lockedUntil - Date.now());
}

export type PinResult = { ok: true } | { ok: false; lockedForMs: number; triesLeft: number };

/** Checks the PIN. Every 5 wrong PINs lock entry for a while, doubling each time. */
export async function verifyPin(id: string, pin: string): Promise<PinResult> {
  const attempts = await readAttempts(id);
  if (attempts.lockedUntil > Date.now()) return { ok: false, lockedForMs: attempts.lockedUntil - Date.now(), triesLeft: 0 };

  const stored = await readPin(id);
  if (stored && hashPin(pin, stored.salt) === stored.hash) {
    await SecureStore.deleteItemAsync(settingKey(id, 'pin-attempts'));
    return { ok: true };
  }

  const fails = attempts.fails + 1;
  let lockedUntil = 0;
  if (fails % FAILS_BEFORE_LOCKOUT === 0) {
    const rounds = fails / FAILS_BEFORE_LOCKOUT;
    lockedUntil = Date.now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** (rounds - 1));
  }
  await SecureStore.setItemAsync(settingKey(id, 'pin-attempts'), JSON.stringify({ fails, lockedUntil }));
  return { ok: false, lockedForMs: Math.max(0, lockedUntil - Date.now()), triesLeft: FAILS_BEFORE_LOCKOUT - (fails % FAILS_BEFORE_LOCKOUT) };
}

export async function resetPinAttempts(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(settingKey(id, 'pin-attempts'));
}

// ---- Face ID / fingerprint

export interface BiometricInfo {
  available: boolean;
  /** "Face ID", "face unlock" or "fingerprint" */
  label: string;
  /** Why it can't be used here, when the phone has it but this build can't use it. */
  unavailableReason?: string;
}

/** Running inside the Expo Go app (development), not an installed Kasi Rails build. */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function getBiometricInfo(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = face ? (process.env.EXPO_OS === 'ios' ? 'Face ID' : 'face unlock') : 'fingerprint';
    // Expo Go can't use Face ID on iPhone; it needs the installed app (a development build).
    if (inExpoGo && process.env.EXPO_OS === 'ios' && face) {
      return { available: false, label, unavailableReason: 'Face ID works in the installed Kasi Rails app, not in Expo Go. Use your PIN for now.' };
    }
    if (hardware && !enrolled) {
      return { available: false, label, unavailableReason: `Set up ${label} in your phone's settings first.` };
    }
    return { available: hardware && enrolled, label };
  } catch {
    return { available: false, label: 'fingerprint' };
  }
}

export async function isBiometricsEnabled(id: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(settingKey(id, 'biometrics'))) === '1';
}

export async function setBiometricsEnabled(id: string, enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(settingKey(id, 'biometrics'), enabled ? '1' : '0');
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
