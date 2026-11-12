import * as SecureStore from 'expo-secure-store';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { toHex, type Hex } from 'viem';
import { CHAIN_ID, USDC_ADDRESS, orderIdToNonce, transferWithAuthorizationTypes } from '@kasi-rails/shared';

// The private key lives only in the device's secure storage and never leaves this module's account object.
const KEY_NAME = 'kasi-rails.wallet-key';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let accountPromise: Promise<PrivateKeyAccount> | undefined;

async function loadAccount(): Promise<PrivateKeyAccount> {
  let key = (await SecureStore.getItemAsync(KEY_NAME, STORE_OPTIONS)) as Hex | null;
  if (!key) {
    key = generatePrivateKey();
    await SecureStore.setItemAsync(KEY_NAME, key, STORE_OPTIONS);
  }
  return privateKeyToAccount(key);
}

function getAccount(): Promise<PrivateKeyAccount> {
  accountPromise ??= loadAccount().catch((err) => {
    accountPromise = undefined;
    throw err;
  });
  return accountPromise;
}

/** Creates the wallet on first launch; returns this device's address. */
export async function getAddress(): Promise<Hex> {
  return (await getAccount()).address;
}

export interface UsdcDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface TransferAuthorization {
  from: Hex;
  validAfter: string;
  validBefore: string;
  signature: Hex;
}

/** Signs an EIP-3009 TransferWithAuthorization paying `value` USDC units to `to` for this order. */
export async function signPayment(params: {
  orderId: string;
  to: Hex;
  value: bigint;
  validBefore: bigint;
  domain: UsdcDomain;
}): Promise<TransferAuthorization> {
  return sign({ to: params.to, value: params.value, validBefore: params.validBefore, nonce: orderIdToNonce(params.orderId), domain: params.domain });
}

/** How long a payment to a friend stays valid after signing. */
const TRANSFER_VALIDITY_S = 300;

export interface FriendTransfer extends TransferAuthorization {
  to: Hex;
  value: string;
  nonce: Hex;
}

/** Signs a payment to a friend, with a random one-time nonce. */
export async function signTransfer(params: { to: Hex; value: bigint; domain: UsdcDomain }): Promise<FriendTransfer> {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + TRANSFER_VALIDITY_S);
  const auth = await sign({ to: params.to, value: params.value, validBefore, nonce, domain: params.domain });
  return { ...auth, to: params.to, value: params.value.toString(), nonce };
}

async function sign(params: { to: Hex; value: bigint; validBefore: bigint; nonce: Hex; domain: UsdcDomain }): Promise<TransferAuthorization> {
  const { domain } = params;
  // Only ever sign for real USDC on the expected chain, whatever the server says.
  if (domain.chainId !== CHAIN_ID || domain.verifyingContract.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
    throw new Error('Unexpected payment network.');
  }

  const account = await getAccount();
  const signature = await account.signTypedData({
    domain: { name: domain.name, version: domain.version, chainId: CHAIN_ID, verifyingContract: USDC_ADDRESS },
    types: transferWithAuthorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to: params.to,
      value: params.value,
      validAfter: 0n,
      validBefore: params.validBefore,
      nonce: params.nonce,
    },
  });
  return { from: account.address, validAfter: '0', validBefore: params.validBefore.toString(), signature };
}
