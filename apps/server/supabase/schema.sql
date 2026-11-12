-- Kasi Rails schema. Run once in the Supabase SQL Editor (safe to re-run).
--
-- Row Level Security is enabled with no policies, so the public (publishable)
-- key can't read or write anything. The server uses the secret key, which
-- bypasses RLS.

create table if not exists public.orders (
  id              text primary key,
  type            text not null default 'sale' check (type in ('sale', 'cashout')),
  zar_cents       integer not null check (zar_cents > 0),
  -- USDC base units (6 decimals)
  usdc_amount     bigint not null check (usdc_amount > 0),
  status          text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'EXPIRED', 'REFUNDED')),
  payer           text,
  tx_hash         text unique,
  refund_tx_hash  text unique,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_pending_expires_idx on public.orders (expires_at) where status = 'PENDING';

alter table public.orders enable row level security;

create table if not exists public.topups (
  id                text primary key,
  zar_cents         integer not null check (zar_cents > 0),
  fee_zar_cents     integer not null check (fee_zar_cents >= 0),
  -- USDC base units (6 decimals)
  usdc_amount       bigint not null check (usdc_amount > 0),
  customer_address  text not null,
  tx_hash           text not null unique,
  created_at        timestamptz not null default now()
);

create index if not exists topups_created_at_idx on public.topups (created_at desc);

alter table public.topups enable row level security;
