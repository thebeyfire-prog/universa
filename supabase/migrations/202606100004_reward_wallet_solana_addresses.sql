alter table public.tenant_reward_wallets
  drop constraint if exists tenant_reward_wallets_wallet_address_check;

alter table public.tenant_reward_wallets
  add constraint tenant_reward_wallets_wallet_address_check
  check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  );

alter table public.developer_reward_allocations
  drop constraint if exists developer_reward_allocations_wallet_address_check;

alter table public.developer_reward_allocations
  add constraint developer_reward_allocations_wallet_address_check
  check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  );

alter table public.developer_reward_claims
  drop constraint if exists developer_reward_claims_wallet_address_check;

alter table public.developer_reward_claims
  add constraint developer_reward_claims_wallet_address_check
  check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    or wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  );
