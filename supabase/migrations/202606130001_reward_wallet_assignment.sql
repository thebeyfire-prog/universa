alter table public.tenant_reward_wallets
  drop constraint if exists tenant_reward_wallets_wallet_provider_check;

alter table public.tenant_reward_wallets
  add constraint tenant_reward_wallets_wallet_provider_check
  check (wallet_provider in ('privy', 'external', 'universa'));

alter table public.tenant_reward_wallets
  add column if not exists chain text not null default 'solana'
    check (chain in ('solana')),
  add column if not exists wallet_secret_ciphertext text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null;

comment on column public.tenant_reward_wallets.wallet_secret_ciphertext is
  'Encrypted Universa custody wallet secret. Never returned to browser clients.';

comment on column public.tenant_reward_wallets.assigned_at is
  'Timestamp when Universa assigned the immutable reward wallet after account KYC/KYB approval.';

create or replace function public.enforce_reward_wallet_assignment_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id
    or new.wallet_provider is distinct from old.wallet_provider
    or new.wallet_address is distinct from old.wallet_address
    or new.custody_model is distinct from old.custody_model
    or new.chain is distinct from old.chain
    or new.wallet_secret_ciphertext is distinct from old.wallet_secret_ciphertext
    or new.assigned_at is distinct from old.assigned_at
    or new.assigned_by is distinct from old.assigned_by then
    raise exception 'Reward wallet assignment is immutable after KYC assignment'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tenant_reward_wallets_assignment_immutable
  on public.tenant_reward_wallets;
create trigger tenant_reward_wallets_assignment_immutable
  before update on public.tenant_reward_wallets
  for each row
  execute function public.enforce_reward_wallet_assignment_immutable();

comment on function public.enforce_reward_wallet_assignment_immutable() is
  'Prevents changing the Universa-assigned reward wallet address, provider, chain, custody secret, or assignment metadata after creation.';
