import { existsSync } from 'node:fs';
import type { Hex } from 'viem';
import { ENV_PATH } from './paths';

/** Loads the root .env into process.env (existing variables win). */
export function loadEnv() {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
}

export function isPrivateKey(value: string | undefined): value is Hex {
  return !!value && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** Reads a private key from env. Errors name the variable, never the value. */
export function requirePrivateKey(name: string): Hex {
  const value = process.env[name];
  if (!isPrivateKey(value)) {
    throw new Error(`${name} is missing or not a valid private key. Run "npm run setup:wallets".`);
  }
  return value;
}
