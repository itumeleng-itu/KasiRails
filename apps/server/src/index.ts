import { addressUrl } from '@kasi-rails/shared';
import { createApp } from './app';
import { createRelayer } from './chain';
import { loadConfig } from './config';
import { createPayments } from './payments';
import { lanAddresses, publicUrl } from './network';
import { createOrderRepo } from './repo';
import { createTopUps } from './topups';

const SWEEP_INTERVAL_MS = 5_000;

async function main() {
  const config = loadConfig();
  const repo = createOrderRepo(config);
  await repo.check();

  const relayer = createRelayer(config.relayerKey);
  const payments = createPayments({ repo, relayer, shopAddress: config.shopAddress });
  const topUps = createTopUps({
    repo,
    relayer,
    shopKey: config.shopKey,
    feeBps: config.topupFeeBps,
    ownerPin: config.ownerPin,
    fallbackZarPerUsdc: config.fallbackZarPerUsdc,
  });
  const app = createApp({ config, repo, payments, topUps });

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
    console.log(`  Phones:   ${publicUrl(config.port, config.publicUrlOverride)}  (put in till QR codes; set PUBLIC_URL to override)`);
    console.log(`  Till:     http://localhost:${config.port}/vendor/till.html`);
    for (const ip of lanAddresses()) console.log(`            http://${ip}:${config.port}/vendor/till.html`);
  });
}

main().catch((err) => {
  console.error(`Failed to start: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
