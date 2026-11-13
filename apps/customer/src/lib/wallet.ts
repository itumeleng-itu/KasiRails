import { toHex, type Hex } from 'viem';
import { CHAIN_ID, USDC_ADDRESS, orderIdToNonce, transferWithAuthorizationTypes } from '@kasi-rails/shared';

import { activeSigner } from './accounts';

// Signing always uses the logged-in account's wallet (see accounts.ts). Keys never leave the phone.

/** The logged-in account's address. */
export async function getAddress(): Promise<Hex> {
  return activeSigner().address;
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
  const { domain } = params;
  // Only ever sign for real USDC on the expected chain, whatever the server says.
  if (domain.chainId !== CHAIN_ID || domain.verifyingContract.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
    throw new Error('Unexpected payment network.');
  }

  const account = activeSigner();
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
      nonce: orderIdToNonce(params.orderId),
    },
  });
  return { from: account.address, validAfter: '0', validBefore: params.validBefore.toString(), signature };
}

/** How long a payment to another person stays valid after signing. */
const TRANSFER_VALIDITY_S = 300;

export interface PersonTransfer extends TransferAuthorization {
  to: Hex;
  value: string;
  nonce: Hex;
}

/** Signs a payment of `value` USDC units to another wallet, with a random one-time nonce. */
export async function signTransfer(params: { to: Hex; value: bigint; domain: UsdcDomain }): Promise<PersonTransfer> {
  const { domain } = params;
  if (domain.chainId !== CHAIN_ID || domain.verifyingContract.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
    throw new Error('Unexpected payment network.');
  }
  const account = activeSigner();
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + TRANSFER_VALIDITY_S);
  const signature = await account.signTypedData({
    domain: { name: domain.name, version: domain.version, chainId: CHAIN_ID, verifyingContract: USDC_ADDRESS },
    types: transferWithAuthorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message: { from: account.address, to: params.to, value: params.value, validAfter: 0n, validBefore, nonce },
  });
  return { from: account.address, validAfter: '0', validBefore: validBefore.toString(), signature, to: params.to, value: params.value.toString(), nonce };
}
