# Kasi Rails

USDC payments at the spaza till, gasless for customers. Built for the W3Node Node Engine Hackathon 2026 (Merchant & Machine Payments track).

## Problem

_TODO_

## Solution

- **Customers** use an Expo app: a self-custodial wallet with rand-first, plain-language UX.
- **Vendors** use simple web pages served by the Node backend (till, top-up, today).
- **Gasless payments**: the customer signs a USDC EIP-3009 `transferWithAuthorization`; the backend relayer submits it and pays gas.
- **Automatic matching**: the EIP-3009 `nonce` is `keccak256(orderId)`, so every on-chain payment is cryptographically tied to its order.

## Architecture

```
packages/shared   chain constants, USDC ABI fragments, types, helpers
apps/server       Express API, vendor pages (public/), scripts, Supabase schema
apps/customer     Expo app (expo-router)
```

- Chain: Base Sepolia (84532), RPC https://sepolia.base.org, explorer https://sepolia.basescan.org
- Token: test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals). The EIP-712 domain name/version is read from the contract at runtime.
- Rate: VALR USDCZAR public market summary, falling back to `FALLBACK_ZAR_PER_USDC`.

## How to run

Requires Node 22+.

```sh
npm install
npm run typecheck

# Create wallets (shop + relayer); copy the keys into .env
npm run gen-wallet
cp .env.example .env
```

Fund the wallets on Base Sepolia: the relayer needs ETH for gas; USDC comes from https://faucet.circle.com.

_More steps added per milestone._
