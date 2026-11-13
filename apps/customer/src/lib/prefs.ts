import * as SecureStore from 'expo-secure-store';

import { activeAccount, settingKey } from './accounts';

/** Whether the logged-in account hides its balance on Home. */
export async function getHideBalance(): Promise<boolean> {
  const account = activeAccount();
  if (!account) return false;
  return (await SecureStore.getItemAsync(settingKey(account.id, 'hide-balance')).catch(() => null)) === '1';
}

export async function setHideBalance(hidden: boolean): Promise<void> {
  const account = activeAccount();
  if (!account) return;
  await SecureStore.setItemAsync(settingKey(account.id, 'hide-balance'), hidden ? '1' : '0').catch(() => {});
}
