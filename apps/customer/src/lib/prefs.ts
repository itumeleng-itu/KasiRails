import * as SecureStore from 'expo-secure-store';

const HIDE_BALANCE_KEY = 'kasi-rails.hide-balance';

export async function getHideBalance(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HIDE_BALANCE_KEY).catch(() => null)) === '1';
}

export async function setHideBalance(hidden: boolean): Promise<void> {
  await SecureStore.setItemAsync(HIDE_BALANCE_KEY, hidden ? '1' : '0').catch(() => {});
}
