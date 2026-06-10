alter table public.tenants
  add column if not exists default_fee_bps integer not null default 0
    check (default_fee_bps >= 0 and default_fee_bps <= 300);

alter table public.tenants
  add column if not exists kyb_status text not null default 'not_submitted'
    check (kyb_status in ('not_submitted', 'pending', 'approved', 'rejected')),
  add column if not exists risk_tier text not null default 'sandbox'
    check (risk_tier in ('sandbox', 'standard', 'enhanced', 'blocked')),
  add column if not exists production_approved_at timestamptz;

alter table public.quotes
  add column if not exists universa_fee numeric(36, 18) not null default 0
    check (universa_fee >= 0),
  add column if not exists tenant_fee numeric(36, 18) not null default 0
    check (tenant_fee >= 0),
  add column if not exists universa_fee_bps integer not null default 0
    check (universa_fee_bps >= 0 and universa_fee_bps <= 1000),
  add column if not exists tenant_fee_bps integer not null default 0
    check (tenant_fee_bps >= 0 and tenant_fee_bps <= 300),
  add column if not exists provider_fee_bps integer not null default 0
    check (provider_fee_bps >= 0 and provider_fee_bps <= 1000);

alter table public.transfers
  add column if not exists universa_fee numeric(36, 18) not null default 0,
  add column if not exists tenant_fee numeric(36, 18) not null default 0;

update public.quotes
set universa_fee = platform_fee,
    universa_fee_bps = 30
where universa_fee = 0
  and tenant_fee = 0
  and platform_fee > 0;

update public.transfers
set universa_fee = platform_fee
where universa_fee = 0
  and tenant_fee = 0
  and platform_fee > 0;
