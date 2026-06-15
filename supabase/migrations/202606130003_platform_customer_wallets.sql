create table if not exists public.platform_customer_wallets (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null references public.platform_customers(id) on delete cascade,
  wallet_provider text not null default 'privy'
    check (wallet_provider in ('privy')),
  privy_app_id text not null,
  privy_wallet_id text not null,
  wallet_address text not null
    check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  chain text not null default 'solana'
    check (chain in ('solana')),
  custody_model text not null default 'privy_server_wallet'
    check (custody_model in ('privy_server_wallet')),
  status text not null default 'active'
    check (status in ('active', 'held', 'revoked')),
  assigned_at timestamptz not null default now(),
  exported_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_id),
  unique (privy_app_id, privy_wallet_id),
  unique (wallet_address)
);

create index if not exists platform_customer_wallets_tenant_customer_idx
  on public.platform_customer_wallets (tenant_id, customer_id);

create index if not exists platform_customer_wallets_tenant_status_idx
  on public.platform_customer_wallets (tenant_id, status, created_at desc);

alter table public.platform_customer_wallets enable row level security;

create or replace function public.enforce_platform_customer_wallet_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id
    or new.customer_id <> old.customer_id
    or new.wallet_provider is distinct from old.wallet_provider
    or new.privy_app_id is distinct from old.privy_app_id
    or new.privy_wallet_id is distinct from old.privy_wallet_id
    or new.wallet_address is distinct from old.wallet_address
    or new.chain is distinct from old.chain
    or new.custody_model is distinct from old.custody_model
    or new.assigned_at is distinct from old.assigned_at then
    raise exception 'Customer wallet assignment is immutable after KYC assignment'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_customer_wallets_immutable
  on public.platform_customer_wallets;
create trigger platform_customer_wallets_immutable
  before update on public.platform_customer_wallets
  for each row
  execute function public.enforce_platform_customer_wallet_immutable();

alter table public.platform_state_events
  drop constraint if exists platform_state_events_resource_type_check;

alter table public.platform_state_events
  add constraint platform_state_events_resource_type_check
  check (
    resource_type in (
      'customer',
      'customer_wallet',
      'kyc_session',
      'virtual_account',
      'quote',
      'transfer',
      'ledger_transaction'
    )
  );

comment on table public.platform_customer_wallets is
  'Immutable Privy Solana wallet assignments for API tenant customers after active KYC.';

comment on column public.platform_customer_wallets.privy_wallet_id is
  'Privy server wallet id. The private key is provider-managed and is never stored in Universa.';

comment on column public.platform_customer_wallets.exported_at is
  'Last timestamp Universa brokered an HPKE-encrypted Privy wallet export request.';
