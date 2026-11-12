/**
 * Ensures .env has valid SHOP / RELAYER / CUSTOMER private keys, generating any
 * that are missing or invalid. Never prints private keys.
 *
 * Usage:
 *   npm run setup:wallets             fill in missing/invalid keys
 *   npm run setup:wallets -- --force  regenerate all three
 *   npm run setup:wallets -- --show   print addresses only, change nothing
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { addressUrl } from '@kasi-rails/shared';
import { ENV_EXAMPLE_PATH, ENV_PATH, ROOT_DIR } from '../src/paths';

const ROLES = [
  { key: 'SHOP_PRIVATE_KEY', role: 'Shop' },
  { key: 'RELAYER_PRIVATE_KEY', role: 'Relayer' },
  { key: 'CUSTOMER_PRIVATE_KEY', role: 'Customer' },
] as const;

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const show = args.has('--show');
for (const a of args) {
  if (a !== '--force' && a !== '--show') fail(`Unknown flag ${a}. Use --force or --show.`);
}
if (force && show) fail('--force and --show cannot be used together.');

const envLabel = relative(ROOT_DIR, ENV_PATH);

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function toAccountAddress(value: string | undefined): string | null {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  try {
    return privateKeyToAccount(value as Hex).address;
  } catch {
    return null; // e.g. zero or out of the secp256k1 range
  }
}

function parseValue(raw: string): string {
  const v = raw.trim();
  const quoted = v.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2] : v;
}

function assertEnvIgnored() {
  try {
    execFileSync('git', ['check-ignore', '-q', ENV_PATH], { cwd: ROOT_DIR, stdio: 'ignore' });
    return;
  } catch (err) {
    // Exit code 1 means "not ignored"; anything else means git is unavailable, so fall back to reading .gitignore.
    if ((err as { status?: number }).status === 1) {
      fail(`${envLabel} is not ignored by git. Add ".env" to .gitignore before writing keys.`);
    }
  }
  const gitignorePath = `${ROOT_DIR}/.gitignore`;
  const listed =
    existsSync(gitignorePath) &&
    readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .some((l) => ['.env', '/.env', '.env*', '/.env*'].includes(l.trim()));
  if (!listed) fail(`".env" is not listed in .gitignore. Add it before writing keys.`);
}

function printTable(rows: { role: string; address: string; status: string }[]) {
  const roleW = Math.max(4, ...rows.map((r) => r.role.length));
  const addrW = 42;
  console.log('');
  console.log(`${'Role'.padEnd(roleW)}  ${'Address'.padEnd(addrW)}  Basescan`);
  console.log(`${'-'.repeat(roleW)}  ${'-'.repeat(addrW)}  ${'-'.repeat(60)}`);
  for (const r of rows) {
    const link = r.address.startsWith('0x') ? addressUrl(r.address) : '';
    console.log(`${r.role.padEnd(roleW)}  ${r.address.padEnd(addrW)}  ${link}${r.status ? `  (${r.status})` : ''}`);
  }
  console.log('');
}

function printFundingSteps(addresses: Record<string, string>) {
  console.log('Funding (Base Sepolia):');
  console.log('  1. https://faucet.circle.com -> Base Sepolia -> USDC');
  console.log(`     send to Shop     ${addresses.Shop}`);
  console.log(`     send to Customer ${addresses.Customer}`);
  console.log('  2. https://portal.cdp.coinbase.com -> Faucets -> Base Sepolia -> ETH');
  console.log(`     send to Relayer  ${addresses.Relayer}`);
  console.log(`     send to Shop     ${addresses.Shop}`);
  console.log('');
}

/** Warns (without echoing content) about lines that look like pasted keys outside a KEY=value entry. */
function warnStrayKeys(lines: string[]) {
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) return;
    if (/0x[0-9a-fA-F]{64}/.test(line)) {
      console.warn(`Warning: line ${i + 1} of ${envLabel} contains what looks like a private key outside a KEY=value entry. Delete it.`);
    }
  });
}

// --- main ---

if (!existsSync(ENV_PATH)) {
  if (show) fail(`${envLabel} does not exist. Run "npm run setup:wallets" first.`);
  assertEnvIgnored();
  if (existsSync(ENV_EXAMPLE_PATH)) {
    copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    console.log(`Created ${envLabel} from .env.example`);
  } else {
    writeFileSync(ENV_PATH, '');
    console.log(`Created empty ${envLabel}`);
  }
}

const original = readFileSync(ENV_PATH, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const lines = original.split(/\r?\n/);
// Drop the empty element produced by a trailing newline; re-added on write.
const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
if (hadTrailingNewline) lines.pop();

const rows: { role: string; address: string; status: string }[] = [];
const addresses: Record<string, string> = {};
let changed = false;

if (!show) assertEnvIgnored();

for (const { key, role } of ROLES) {
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  const idx = lines.findIndex((l) => re.test(l));
  const current = idx >= 0 ? parseValue(lines[idx].match(re)![1]) : undefined;
  const existing = toAccountAddress(current);

  if (show) {
    const status = existing ? '' : idx < 0 || !current ? 'missing' : 'invalid';
    rows.push({ role, address: existing ?? '-', status });
    if (existing) addresses[role] = existing;
    continue;
  }

  if (existing && !force) {
    rows.push({ role, address: existing, status: 'kept' });
    addresses[role] = existing;
    continue;
  }

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  if (idx >= 0) lines[idx] = `${key}=${pk}`;
  else lines.push(`${key}=${pk}`);
  changed = true;
  const status = force && existing ? 'regenerated' : idx < 0 || !current ? 'generated, was missing' : 'generated, was invalid';
  rows.push({ role, address, status });
  addresses[role] = address;
}

if (changed) {
  writeFileSync(ENV_PATH, lines.join(eol) + (hadTrailingNewline || lines.length ? eol : ''));
  console.log(`Updated ${envLabel}`);
}

printTable(rows);
warnStrayKeys(lines);

if (show && rows.some((r) => r.status)) {
  console.log('Some keys are missing or invalid. Run "npm run setup:wallets" to fill them in.\n');
} else if (Object.keys(addresses).length === ROLES.length) {
  printFundingSteps(addresses);
}
