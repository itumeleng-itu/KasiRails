# Kasi Rails

Lets any spaza accept stablecoins as easily as cash, and sell them to customers who only have cash.

## Hackathon

Built for the **W3Node Node Engine Hackathon 2026**, **Merchant & Machine Payments** track.

## The problem

South Africa's corner shops run on cash. Spaza owners handle cash all day but earn nothing extra on it, and they can't take digital payments without card machines and merchant accounts that many of them can't get.

Customers who only have cash can't buy stablecoins without a bank account, an exchange login and crypto know-how.

Existing stablecoin checkouts assume the customer already holds crypto, and they end every sale with a sweep to a bank.

## The solution

The shop is both the till and the ramp.

- **Pay at the till.** The shop shows a QR code, the customer pays in USDC from the Kasi Rails app, and the shop sees **PAID** within seconds.
- **Buy USDC with cash.** The shop sells USDC from its float to cash customers, for a small fee.
- **Till income becomes float.** USDC taken at the till is the float for the next cash customer. A bank is only needed to rebalance.

## How it works

1. The shop keys in an amount in rand on the till page. The backend creates an order priced at the live USDC/ZAR rate and shows it as a QR code.
2. The customer scans the QR code in the Kasi Rails app and sees "Pay R85.00 to Mama Thoko's Spaza?".
3. The app signs a USDC transfer authorization on the phone. The private key never leaves the device.
4. The backend checks the authorization against the order and submits it to Base Sepolia through its relayer, which pays the gas.
5. Once the transaction is confirmed, the order is marked PAID and the till page turns green.

```mermaid
flowchart LR
    subgraph Customer
        A[Kasi Rails app<br/>Expo, self-custodial]
    end
    subgraph Shop
        V[Vendor web pages<br/>till, top-up, today]
    end
    subgraph Backend["Node backend (Express)"]
        API[Orders API<br/>rate, matching]
        R[Relayer<br/>pays gas]
        DB[(Supabase)]
    end
    subgraph Chain["Base Sepolia"]
        U[USDC contract<br/>EIP-3009]
    end

    V -- create order, poll status --> API
    A -- scan QR, signed authorization --> API
    API --> DB
    API --> R
    R -- transferWithAuthorization --> U
    U -- receipt --> R
```

## Why it's gasless and auto-matched

- **Gasless.** The customer app signs a USDC [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) `transferWithAuthorization` message instead of sending a transaction. Our relayer submits it on-chain and pays the gas, so customers never need ETH.
- **Auto-matched.** The authorization's `nonce` is `keccak256(orderId)`. Every payment is cryptographically tied to exactly one order. USDC rejects a nonce the payer has already used, and the backend only accepts payment for a pending order, so an order can't be paid twice. There is no manual reconciliation: the backend knows which order a payment belongs to before it reaches the chain.

## Tech stack

- **Chain:** Base Sepolia (chain ID 84532)
- **Token:** test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals). The EIP-712 domain is read from the contract at runtime.
- **Web3:** viem
- **Backend:** Node + Express
- **Database:** Supabase (with an in-memory fallback for local runs)
- **Customer app:** Expo (React Native)
- **Rate:** VALR public API for the USDC/ZAR rate

## Repo structure

```
packages/shared   chain constants, USDC ABI fragments, types, helpers
apps/server       Express API, vendor pages (public/), scripts
apps/customer     Expo customer app
```

## Getting started

### Prerequisites

- Node.js 22+
- npm 10+

### Install

```sh
npm install
```

### Wallets

```sh
npm run setup:wallets
```

This creates `.env` from `.env.example` if needed and fills in the shop, relayer and customer keys. Existing valid keys are kept and keys are never printed. Use `-- --show` to print the addresses only, or `-- --force` to regenerate all three.

Fund the wallets on Base Sepolia:

- **USDC** from [faucet.circle.com](https://faucet.circle.com) (select Base Sepolia) for the shop and customer
- **ETH** from the [Coinbase Developer Platform faucet](https://portal.cdp.coinbase.com) (Faucets, then Base Sepolia) for the relayer (gas) and the shop

### Run

- Gasless payment spike: `npm run spike` sends 0.10 USDC from the customer to the shop. The customer signs, the relayer pays the gas, and the script prints the Basescan link and balances. Each order id can be paid once, so use `npm run spike -- --order spike-2` (and so on) to run it again.
- Server and till page:
  1. Optional: to use Supabase, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the project's secret key) in `.env`, and run `apps/server/supabase/schema.sql` once in the Supabase SQL Editor. Leave `SUPABASE_URL` empty to use the in-memory store.
  2. `npm run dev:server` (or `npm run start:server` without auto-reload).
  3. Open the till URL the server prints. On a phone, use the LAN address (for example `http://192.168.x.x:3000/vendor/till.html`) so the QR code points somewhere the customer's phone can reach.
  4. The payment sound `apps/server/public/audio/paid.mp3` is a placeholder (empty file). We will record the real clip; until then the till plays a short chime.
- Customer app (Expo SDK 58, runs in Expo Go):
  1. Copy `apps/customer/.env.example` to `apps/customer/.env`. It points the app at the hosted server, https://kasi-rails.onrender.com, which works from any network. Alternatively, leave `EXPO_PUBLIC_API_URL` empty and run the server on the same computer as Expo. The app finds it automatically (same host as Expo, port 3000), and the till puts the computer's network address in its QR codes, so the till can be opened at `localhost`. The phone must be on the same network as the computer. To use a server elsewhere, set `EXPO_PUBLIC_API_URL` in `apps/customer/.env` (see `.env.example`); to override the address in till QR codes, set `PUBLIC_URL` in the root `.env`.
  2. `npm run dev:app`, then scan the QR code in the terminal with Expo Go (Android) or the Camera app (iOS).
  3. On first launch the app creates a key on the phone (stored in secure storage, never sent anywhere). Tap **Receive** to see the code, and fund it with USDC from [faucet.circle.com](https://faucet.circle.com) for testing.
  4. On the till page charge an amount, then tap **Pay** in the app and scan the till's QR code.

### Deploy the server (Render)

The repo has a `Dockerfile` that installs only the server and the shared package, and a `render.yaml` Blueprint.

1. In Render, choose **New → Blueprint** and connect this GitHub repo. Render reads `render.yaml` (Docker web service, free plan, branch `dev`, health check `/health`).
2. When asked, paste the secret values from your `.env`: `SHOP_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Don't add `CUSTOMER_PRIVATE_KEY` or the database connection string.
3. Deploy. The server uses `RENDER_EXTERNAL_URL` (e.g. `https://kasi-rails.onrender.com`) in till QR codes; set `PUBLIC_URL` to override.
4. Point the app at it: set `EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com` in `apps/customer/.env` and reload the app.

Free Render services sleep after 15 minutes without traffic and take about a minute to wake. Before a demo, open `/health` to wake it, or ping it every 10 minutes with an uptime monitor. Run a single instance, and stop any local server that uses the same relayer key and database.

The same `Dockerfile` also works on Railway or any Docker host (Railway's `RAILWAY_PUBLIC_DOMAIN` is supported too).

## Status

- [x] Milestone 1: scaffold, shared package, wallet tools
- [x] Milestone 2: gasless payment spike ([first transfer on Base Sepolia](https://sepolia.basescan.org/tx/0xa3805a9eba443c28d0b35bad5bcc02793c19334a1e03d7a992e9e5de56d27b3a))
- [x] Milestone 3: server API and till page
- [ ] Milestone 4: customer app, end to end

## Roadmap

- Refunds and late payments
- Cash top-up
- Merchant dashboard
- Sepedi and isiZulu voice confirmation
- Passkey wallets
- ZARP (rand stablecoin)
- Cash-out via VALR or Kotani Pay
- Per-order deposit addresses

## Demo video

Link coming soon.

## Team

- Matome Tjale (team lead)
- Halaletsang Malefahlo
- Ntokozo Nkambule

## Testnet only

Kasi Rails runs on Base Sepolia with test tokens and never handles real funds. Never commit private keys: `.env` is git-ignored, and `npm run setup:wallets` refuses to write keys if it isn't.
