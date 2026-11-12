import { baseSepolia } from 'viem/chains';

/** Base Sepolia testnet. */
export const CHAIN = baseSepolia;
export const CHAIN_ID = 84532 as const;
export const RPC_URL = 'https://sepolia.base.org';
export const EXPLORER_URL = 'https://sepolia.basescan.org';

/** Circle test USDC on Base Sepolia. */
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const USDC_DECIMALS = 6;

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`;
