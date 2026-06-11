create table if not exists public.tenant_reward_wallets (
  tenant_id text primary key references public.tenants(id) on delete cascade,
  wallet_provider text not null default 'privy'
    check (wallet_provider in ('privy', 'external')),
  wallet_address text not null check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  privy_user_id text,
  privy_wallet_id text,
  custody_model text not null default 'user_embedded'
    check (custody_model in ('user_embedded', 'server_wallet', 'external')),
  status text not null default 'active'
    check (status in ('active', 'held', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_reward_wallets_wallet_address_idx
  on public.tenant_reward_wallets (lower(wallet_address));

create table if not exists public.developer_reward_epochs (
  id uuid primary key default gen_random_uuid(),
  epoch_number integer not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded', 'void')),
  volume_start_at timestamptz not null,
  volume_end_at timestamptz not null,
  merkle_root text check (merkle_root is null or merkle_root ~ '^0x[0-9a-fA-F]{64}$'),
  allocation_uri text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (volume_end_at > volume_start_at)
);

create table if not exists public.developer_reward_allocations (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.developer_reward_epochs(id) on delete cascade,
  tenant_id text not null references public.tenants(id) on delete cascade,
  wallet_address text not null check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  lifetime_settled_volume_usd numeric(36, 2) not null default 0
    check (lifetime_settled_volume_usd >= 0),
  epoch_settled_volume_usd numeric(36, 2) not null default 0
    check (epoch_settled_volume_usd >= 0),
  cumulative_token_amount numeric(78, 0) not null
    check (cumulative_token_amount >= 0),
  milestone_label text not null,
  hold_reason text,
  calculation jsonb not null default '{}'::jsonb,
  merkle_proof jsonb not null default '[]'::jsonb,
  status text not null default 'eligible'
    check (status in ('eligible', 'held', 'claimed', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (epoch_id, tenant_id)
);

create index if not exists developer_reward_allocations_tenant_idx
  on public.developer_reward_allocations (tenant_id, created_at desc);

create table if not exists public.developer_reward_claims (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.developer_reward_epochs(id) on delete restrict,
  tenant_id text not null references public.tenants(id) on delete cascade,
  wallet_address text not null check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  cumulative_token_amount numeric(78, 0) not null
    check (cumulative_token_amount >= 0),
  claimed_token_amount numeric(78, 0) not null
    check (claimed_token_amount >= 0),
  tx_hash text check (tx_hash is null or tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'failed', 'replaced')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists developer_reward_claims_tenant_idx
  on public.developer_reward_claims (tenant_id, created_at desc);
create unique index if not exists developer_reward_claims_tx_hash_idx
  on public.developer_reward_claims (tx_hash)
  where tx_hash is not null;
