/**
 * Prints a fresh wallet to stdout. Nothing is written to disk.
 * Usage: npm run gen-wallet
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { addressUrl } from '@kasi-rails/shared';

const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);

console.log(`Address:     ${address}`);
console.log(`Private key: ${privateKey}`);
console.log(`Explorer:    ${addressUrl(address)}`);
console.log('');
console.log('Copy the private key into your .env now; it is not saved anywhere.');
console.log('Fund on Base Sepolia: ETH (for the relayer) and USDC from https://faucet.circle.com');
