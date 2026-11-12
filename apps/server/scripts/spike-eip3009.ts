/**
 * Gasless payment spike: the customer signs an EIP-3009 TransferWithAuthorization
 * for 0.10 USDC to the shop, and the relayer submits it and pays gas.
 *
 * Usage:
 *   npm run spike                        order id "spike-1"
 *   npm run spike -- --order spike-2     another order id (each id can be paid once per customer)
 *
 * Uses CUSTOMER_PRIVATE_KEY from .env if set, otherwise a throwaway key.
 */
import { BaseError, ContractFunctionRevertedError, formatEther, formatUnits, parseEventLogs, parseSignature, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  USDC_ADDRESS,
  USDC_DECIMALS,
  addressUrl,
  orderIdToNonce,
  transferWithAuthorizationTypes,
  txUrl,
  usdcAbi,
} from '@kasi-rails/shared';
import { createRelayer, getUsdcDomain, publicClient, usdcBalance } from '../src/chain';
import { isPrivateKey, loadEnv, requirePrivateKey } from '../src/env';

const AMOUNT = 100_000n; // 0.10 USDC
const VALIDITY_SECONDS = 120n;

const fmt = (units: bigint) => `${formatUnits(units, USDC_DECIMALS)} USDC`;

function parseOrderId(): string {
  const i = process.argv.indexOf('--order');
  if (i === -1) return 'spike-1';
  const id = process.argv[i + 1];
  if (!id || id.startsWith('--')) throw new Error('--order needs a value, e.g. --order spike-2');
  return id;
}

async function main() {
  loadEnv();
  const orderId = parseOrderId();

  const relayer = createRelayer(requirePrivateKey('RELAYER_PRIVATE_KEY'));
  const shop = privateKeyToAccount(requirePrivateKey('SHOP_PRIVATE_KEY'));
  const customerKey = process.env.CUSTOMER_PRIVATE_KEY;
  const usingThrowaway = !isPrivateKey(customerKey);
  const customer = privateKeyToAccount(usingThrowaway ? generatePrivateKey() : customerKey);

  console.log(`Order id:  ${orderId}`);
  console.log(`Customer:  ${customer.address}${usingThrowaway ? ' (throwaway key, not saved)' : ''}`);
  console.log(`Shop:      ${shop.address}`);
  console.log(`Relayer:   ${relayer.account.address}`);
  console.log('');

  // Preflight: funds and nonce.
  const nonce = orderIdToNonce(orderId);
  const [customerBefore, shopBefore, relayerEth, nonceUsed] = await Promise.all([
    usdcBalance(customer.address),
    usdcBalance(shop.address),
    publicClient.getBalance({ address: relayer.account.address }),
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: 'authorizationState',
      args: [customer.address, nonce],
    }),
  ]);

  if (customerBefore < AMOUNT) {
    console.log(`The customer has ${fmt(customerBefore)} and needs at least ${fmt(AMOUNT)}.`);
    console.log(`Fund ${customer.address} with USDC on Base Sepolia at https://faucet.circle.com, then run this again.`);
    if (usingThrowaway) console.log('Tip: this is a throwaway key. Run "npm run setup:wallets" so the customer address stays the same.');
    return;
  }
  if (relayerEth === 0n) {
    console.log(`The relayer has no ETH for gas. Fund ${relayer.account.address} from https://portal.cdp.coinbase.com (Faucets, Base Sepolia).`);
    return;
  }
  if (nonceUsed) {
    console.log(`Order "${orderId}" has already been paid by this customer (its nonce is used on-chain).`);
    console.log('Run again with a new id, e.g. npm run spike -- --order spike-2');
    return;
  }

  // Customer side: sign the authorization. Domain comes from the contract.
  const domain = await getUsdcDomain();
  console.log(`USDC EIP-712 domain: name="${domain.name}" version="${domain.version}" chainId=${domain.chainId}`);

  const message = {
    from: customer.address,
    to: shop.address,
    value: AMOUNT,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000)) + VALIDITY_SECONDS,
    nonce,
  };
  const signature = await customer.signTypedData({
    domain,
    types: transferWithAuthorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const valid = await verifyTypedData({
    address: customer.address,
    domain,
    types: transferWithAuthorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message,
    signature,
  });
  if (!valid) throw new Error('Signature does not verify locally; check the EIP-712 domain.');

  // Relayer side: split the signature and submit.
  const { r, s, v, yParity } = parseSignature(signature);
  const vNum = v !== undefined ? Number(v) : yParity + 27;

  console.log(`Submitting transferWithAuthorization for ${fmt(AMOUNT)}...`);
  const { request } = await publicClient.simulateContract({
    account: relayer.account,
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'transferWithAuthorization',
    args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, vNum, r, s],
  });
  const hash = await relayer.writeContract(request);
  console.log(`Tx hash:   ${hash}`);
  console.log(`Basescan:  ${txUrl(hash)}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted in block ${receipt.blockNumber}.`);

  // Automatic matching: the AuthorizationUsed event carries the order's nonce.
  const [used] = parseEventLogs({ abi: usdcAbi, eventName: 'AuthorizationUsed', logs: receipt.logs });
  const matched = used?.args.nonce === nonce;
  const gasEth = receipt.gasUsed * receipt.effectiveGasPrice;

  // Read balances at the receipt's block so a lagging RPC node can't show stale values.
  const [customerAfter, shopAfter] = await Promise.all([
    usdcBalance(customer.address, receipt.blockNumber),
    usdcBalance(shop.address, receipt.blockNumber),
  ]);

  console.log('');
  console.log(`Confirmed in block ${receipt.blockNumber}. Gas paid by relayer: ${formatEther(gasEth)} ETH`);
  console.log(`AuthorizationUsed nonce ${matched ? 'matches' : 'DOES NOT match'} keccak256("${orderId}")`);
  console.log('');
  console.log(`              before          after`);
  console.log(`Customer  ${fmt(customerBefore).padEnd(14)}  ${fmt(customerAfter)}`);
  console.log(`Shop      ${fmt(shopBefore).padEnd(14)}  ${fmt(shopAfter)}`);
  console.log('');
  console.log(`Shop on Basescan: ${addressUrl(shop.address)}`);
}

main().catch((err) => {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const reason = revert instanceof ContractFunctionRevertedError ? revert.reason ?? revert.shortMessage : undefined;
    console.error(`Error: ${reason ? `USDC rejected the transfer: ${reason}` : err.shortMessage}`);
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
});
