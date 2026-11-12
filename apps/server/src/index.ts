import { networkInterfaces } from 'node:os';
import { addressUrl } from '@kasi-rails/shared';
import { createApp } from './app';
import { createRelayer } from './chain';
import { loadConfig } from './config';
import { createPayments } from './payments';
import { createOrderRepo } from './repo';

const SWEEP_INTERVAL_MS = 5_000;

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
}

async function main() {
  const config = loadConfig();
  const repo = createOrderRepo(config);
  await repo.check();

  const relayer = createRelayer(config.relayerKey);
  const payments = createPayments({ repo, relayer, shopAddress: config.shopAddress });
  const app = createApp({ config, repo, payments });

  let sweeping = false;
  setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await payments.sweep();
    } catch (err) {
      console.error('Sweep failed:', err instanceof Error ? err.message : err);
    } finally {
      sweeping = false;
    }
  }, SWEEP_INTERVAL_MS);

  app.listen(config.port, () => {
    console.log(`Kasi Rails server for ${config.shopName}`);
    console.log(`  Store:    ${repo.kind}`);
    console.log(`  Shop:     ${config.shopAddress}  ${addressUrl(config.shopAddress)}`);
    console.log(`  Relayer:  ${relayer.account.address}  ${addressUrl(relayer.account.address)}`);
    console.log(`  Till:     http://localhost:${config.port}/vendor/till.html`);
    for (const ip of lanAddresses()) console.log(`            http://${ip}:${config.port}/vendor/till.html  (use this on the phone)`);
  });
}

main().catch((err) => {
  console.error(`Failed to start: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
