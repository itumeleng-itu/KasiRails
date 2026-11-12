import * as SecureStore from 'expo-secure-store';
import { getAddress, isAddress, type Hex } from 'viem';

// Friends live only on this phone. Secure storage keeps values small, which is fine for a short list.
const FRIENDS_KEY = 'kasi-rails.friends';
const HIDE_BALANCE_KEY = 'kasi-rails.hide-balance';

export interface Friend {
  name: string;
  address: Hex;
}

let cache: Friend[] | null = null;

export async function listFriends(): Promise<Friend[]> {
  if (cache) return cache;
  try {
    const raw = await SecureStore.getItemAsync(FRIENDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed)
      ? parsed.filter((f): f is Friend => typeof f?.name === 'string' && typeof f?.address === 'string' && isAddress(f.address))
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(friends: Friend[]) {
  const sorted = [...friends].sort((a, b) => a.name.localeCompare(b.name));
  await SecureStore.setItemAsync(FRIENDS_KEY, JSON.stringify(sorted));
  cache = sorted;
}

/** Adds a friend, or renames them if their code is already saved. */
export async function addFriend(name: string, address: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a name.');
  if (!isAddress(address)) throw new Error("That code isn't valid.");
  const checksummed = getAddress(address);
  const others = (await listFriends()).filter((f) => f.address !== checksummed);
  await save([...others, { name: trimmed, address: checksummed }]);
}

export async function removeFriend(address: string): Promise<void> {
  await save((await listFriends()).filter((f) => f.address.toLowerCase() !== address.toLowerCase()));
}

export function findFriend(friends: Friend[], address: string): Friend | undefined {
  return friends.find((f) => f.address.toLowerCase() === address.toLowerCase());
}

export async function getHideBalance(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HIDE_BALANCE_KEY).catch(() => null)) === '1';
}

export async function setHideBalance(hidden: boolean): Promise<void> {
  await SecureStore.setItemAsync(HIDE_BALANCE_KEY, hidden ? '1' : '0').catch(() => {});
}
