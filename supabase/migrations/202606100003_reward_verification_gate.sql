create or replace function public.is_tenant_account_verified(p_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status in ('sandbox', 'active')
      and (
        t.kyb_status = 'approved'
        or lower(coalesce(t.metadata->>'account_kyc_status', '')) in ('active', 'approved')
      )
  );
$$;

create or replace function public.tenant_has_active_reward_wallet(
  p_tenant_id text,
  p_wallet_address text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_reward_wallets w
    where w.tenant_id = p_tenant_id
      and lower(w.wallet_address) = lower(p_wallet_address)
      and w.status = 'active'
  );
$$;

create or replace function public.enforce_reward_wallet_verified_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('active', 'held') and not public.is_tenant_account_verified(new.tenant_id) then
    raise exception 'Account KYC must be active before a reward wallet can be registered'
      using errcode = '42501';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_reward_allocation_verified_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('eligible', 'claimed') then
    if not public.is_tenant_account_verified(new.tenant_id) then
      raise exception 'Account KYC must be active before token rewards can become eligible'
        using errcode = '42501';
    end if;

    if not public.tenant_has_active_reward_wallet(new.tenant_id, new.wallet_address) then
      raise exception 'An active verified reward wallet is required before token rewards can become eligible'
        using errcode = '42501';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_reward_claim_verified_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_tenant_account_verified(new.tenant_id) then
    raise exception 'Account KYC must be active before token rewards can be claimed'
      using errcode = '42501';
  end if;

  if not public.tenant_has_active_reward_wallet(new.tenant_id, new.wallet_address) then
    raise exception 'An active verified reward wallet is required before token rewards can be claimed'
      using errcode = '42501';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_reward_wallets_verified_tenant_gate
  on public.tenant_reward_wallets;
create trigger tenant_reward_wallets_verified_tenant_gate
  before insert or update on public.tenant_reward_wallets
  for each row
  execute function public.enforce_reward_wallet_verified_tenant();

drop trigger if exists developer_reward_allocations_verified_tenant_gate
  on public.developer_reward_allocations;
create trigger developer_reward_allocations_verified_tenant_gate
  before insert or update on public.developer_reward_allocations
  for each row
  execute function public.enforce_reward_allocation_verified_tenant();

drop trigger if exists developer_reward_claims_verified_tenant_gate
  on public.developer_reward_claims;
create trigger developer_reward_claims_verified_tenant_gate
  before insert or update on public.developer_reward_claims
  for each row
  execute function public.enforce_reward_claim_verified_tenant();

alter table public.tenant_reward_wallets enable row level security;
alter table public.developer_reward_epochs enable row level security;
alter table public.developer_reward_allocations enable row level security;
alter table public.developer_reward_claims enable row level security;

revoke all on public.tenant_reward_wallets from anon, authenticated;
revoke all on public.developer_reward_epochs from anon, authenticated;
revoke all on public.developer_reward_allocations from anon, authenticated;
revoke all on public.developer_reward_claims from anon, authenticated;

comment on function public.is_tenant_account_verified(text) is
  'Central reward gate: token reward wallets, eligible allocations, and claims require active account KYC or approved KYB.';
