create table if not exists public.tenant_dashboard_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null references public.tenants(id) on delete cascade,
  role text not null default 'developer'
    check (role in ('owner', 'admin', 'developer', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists tenant_dashboard_users_tenant_idx
  on public.tenant_dashboard_users (tenant_id, status);

alter table public.tenant_dashboard_users enable row level security;

comment on table public.tenant_dashboard_users is
  'Service-role-only mapping between Supabase Auth users and Universa API tenants.';

comment on column public.tenants.metadata is
  'Safe dashboard account fields may include account_kyc_status and provider_customer_id; do not store provider secrets here.';
