import * as SecureStore from 'expo-secure-store';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * Accounts on this phone. Each has its own wallet key, username, PIN and settings,
 * stored separately in secure storage. Keys never leave the phone.
 */

const STORE: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const LIST_KEY = 'kasi-rails.accounts';
const LAST_KEY = 'kasi-rails.last-account';
/** A wallet made for a sign-up that hasn't finished yet, so a retry keeps the same address. */
const PENDING_KEY = 'kasi-rails.pending-key';

export interface AccountInfo {
  /** Lowercase address without 0x; used in storage key names. */
  id: string;
  username: string;
  address: Hex;
  createdAt: string;
}

export type AccountSetting = 'key' | 'pin' | 'pin-attempts' | 'biometrics' | 'hide-balance';

export function settingKey(id: string, setting: AccountSetting): string {
  return `kasi-rails.acct.${id}.${setting}`;
}

const idFor = (address: string) => address.toLowerCase().replace(/^0x/, '');

// ---- The account list

export async function listAccounts(): Promise<AccountInfo[]> {
  try {
    const raw = await SecureStore.getItemAsync(LIST_KEY);
    return raw ? (JSON.parse(raw) as AccountInfo[]) : [];
  } catch {
    return [];
  }
}

async function saveAccounts(accounts: AccountInfo[]) {
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(accounts));
}

export async function getLastAccountId(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_KEY);
}

// ---- The logged-in account

let active: { info: AccountInfo; signer: PrivateKeyAccount } | null = null;

/** Loads the account's key and makes it the one that signs. Call only after the PIN or biometrics check. */
export async function activate(info: AccountInfo): Promise<void> {
  const key = (await SecureStore.getItemAsync(settingKey(info.id, 'key'), STORE)) as Hex | null;
  if (!key) throw new Error(`The wallet for @${info.username} is missing from this phone.`);
  active = { info, signer: privateKeyToAccount(key) };
  await SecureStore.setItemAsync(LAST_KEY, info.id);
}

export function deactivate(): void {
  active = null;
}

export function activeAccount(): AccountInfo | null {
  return active?.info ?? null;
}

export function activeSigner(): PrivateKeyAccount {
  if (!active) throw new Error('Not logged in.');
  return active.signer;
}

// ---- Sign-up

let pending: PrivateKeyAccount | null = null;

/** The wallet being used for a sign-up in progress (created on first call). */
export async function getPendingSigner(): Promise<PrivateKeyAccount> {
  if (pending) return pending;
  let key = (await SecureStore.getItemAsync(PENDING_KEY, STORE)) as Hex | null;
  if (!key) {
    key = generatePrivateKey();
    await SecureStore.setItemAsync(PENDING_KEY, key, STORE);
  }
  pending = privateKeyToAccount(key);
  return pending;
}

/** Saves the sign-up wallet as a new account once its username is registered. */
export async function completeSignup(username: string): Promise<AccountInfo> {
  const key = (await SecureStore.getItemAsync(PENDING_KEY, STORE)) as Hex | null;
  if (!key) throw new Error('Sign-up wallet is missing. Start again.');
  const address = privateKeyToAccount(key).address;
  const info: AccountInfo = { id: idFor(address), username, address, createdAt: new Date().toISOString() };
  await SecureStore.setItemAsync(settingKey(info.id, 'key'), key, STORE);
  const others = (await listAccounts()).filter((a) => a.id !== info.id);
  await saveAccounts([...others, info]);
  await SecureStore.deleteItemAsync(PENDING_KEY, STORE);
  pending = null;
  return info;
}

/** Deletes an account and its wallet key from this phone. Money in it is lost unless moved out first. */
export async function removeAccount(id: string): Promise<void> {
  const settings: AccountSetting[] = ['key', 'pin', 'pin-attempts', 'biometrics', 'hide-balance'];
  await Promise.all(settings.map((s) => SecureStore.deleteItemAsync(settingKey(id, s), s === 'key' ? STORE : undefined).catch(() => {})));
  await saveAccounts((await listAccounts()).filter((a) => a.id !== id));
  if ((await getLastAccountId()) === id) await SecureStore.deleteItemAsync(LAST_KEY);
  if (active?.info.id === id) active = null;
}

// ---- One-time move from the single-account version of the app

const LEGACY = {
  key: 'kasi-rails.wallet-key',
  username: 'kasi-rails.username',
  pin: 'kasi-rails.pin',
  'pin-attempts': 'kasi-rails.pin-attempts',
  biometrics: 'kasi-rails.biometrics',
  'hide-balance': 'kasi-rails.hide-balance',
} as const;

/**
 * Turns the old single wallet into the first account. If it never got a username,
 * it becomes the pending sign-up wallet so its money isn't lost.
 */
export async function migrateLegacyWallet(): Promise<void> {
  const legacyKey = (await SecureStore.getItemAsync(LEGACY.key, STORE)) as Hex | null;
  if (!legacyKey) return;
  const address = privateKeyToAccount(legacyKey).address;
  const id = idFor(address);
  const username = await SecureStore.getItemAsync(LEGACY.username);
  const accounts = await listAccounts();

  if (!accounts.some((a) => a.id === id)) {
    if (username) {
      await SecureStore.setItemAsync(settingKey(id, 'key'), legacyKey, STORE);
      for (const setting of ['pin', 'pin-attempts', 'biometrics', 'hide-balance'] as const) {
        const value = await SecureStore.getItemAsync(LEGACY[setting]);
        if (value !== null) await SecureStore.setItemAsync(settingKey(id, setting), value);
      }
      await saveAccounts([...accounts, { id, username, address, createdAt: new Date().toISOString() }]);
      await SecureStore.setItemAsync(LAST_KEY, id);
    } else if (!(await SecureStore.getItemAsync(PENDING_KEY, STORE))) {
      await SecureStore.setItemAsync(PENDING_KEY, legacyKey, STORE);
    }
  }

  // Only delete the old entries once the key is safely stored under its new name.
  const savedKey = (await SecureStore.getItemAsync(settingKey(id, 'key'), STORE)) ?? (await SecureStore.getItemAsync(PENDING_KEY, STORE));
  if (savedKey === legacyKey) {
    await Promise.all(Object.values(LEGACY).map((k) => SecureStore.deleteItemAsync(k, k === LEGACY.key ? STORE : undefined).catch(() => {})));
  }
}
