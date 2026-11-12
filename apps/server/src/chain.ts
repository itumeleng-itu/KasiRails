import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, RPC_URL, USDC_ADDRESS, usdcAbi } from '@kasi-rails/shared';

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export function createRelayer(privateKey: Hex) {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain: CHAIN, transport: http(RPC_URL) });
}

export interface UsdcDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: typeof USDC_ADDRESS;
}

let domainPromise: Promise<UsdcDomain> | undefined;

/** EIP-712 domain for USDC, read from the contract once and cached. */
export function getUsdcDomain(): Promise<UsdcDomain> {
  domainPromise ??= Promise.all([
    publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'name' }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'version' }),
  ])
    .then(([name, version]) => ({ name, version, chainId: CHAIN.id, verifyingContract: USDC_ADDRESS }))
    .catch((err) => {
      domainPromise = undefined; // retry on the next call
      throw err;
    });
  return domainPromise;
}

export function usdcBalance(address: Hex, blockNumber?: bigint) {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: [address],
    blockNumber,
  });
}
