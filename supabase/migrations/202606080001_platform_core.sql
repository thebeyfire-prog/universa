create extension if not exists pgcrypto;

create table public.tenants (
  id text primary key,
  name text not null,
  status text not null default 'sandbox'
    check (status in ('sandbox', 'active', 'suspended', 'closed')),
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_provider_configs (
  tenant_id text not null references public.tenants(id) on delete cascade,
  provider text not null,
  status text not null default 'disabled'
    check (status in ('disabled', 'sandbox', 'active', 'suspended')),
  approval_status text not null default 'not_submitted'
    check (approval_status in ('not_submitted', 'pending', 'approved', 'rejected')),
  provider_subdeveloper_ref text,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);

create table public.tenant_api_keys (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  secret_ciphertext text not null,
  scopes text[] not null default array['customers:read']::text[],
  status text not null default 'active'
    check (status in ('active', 'disabled', 'revoked')),
  ip_allowlist text[] not null default array[]::text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index tenant_api_keys_tenant_created_idx
  on public.tenant_api_keys (tenant_id, created_at desc);

create table public.api_nonces (
  api_key_id text not null references public.tenant_api_keys(id) on delete cascade,
  nonce text not null,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now(),
  primary key (api_key_id, nonce)
);

create index api_nonces_created_idx on public.api_nonces (created_at);

create table public.platform_customers (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  external_id text not null,
  type text not null check (type in ('individual', 'business')),
  full_name text not null,
  email text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  status text not null default 'created'
    check (status in (
      'created', 'kyc_pending', 'active', 'rejected',
      'restricted', 'suspended', 'closed'
    )),
  provider text,
  provider_customer_id text,
  provider_kyc_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_id),
  unique (provider, provider_customer_id)
);

create index platform_customers_tenant_created_idx
  on public.platform_customers (tenant_id, created_at desc);

create table public.kyc_sessions (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null references public.platform_customers(id) on delete cascade,
  provider text not null,
  provider_session_id text,
  status text not null
    check (status in ('created', 'pending', 'active', 'rejected', 'expired')),
  tos_url text,
  kyc_url text,
  expires_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kyc_sessions_tenant_customer_idx
  on public.kyc_sessions (tenant_id, customer_id, created_at desc);

create table public.virtual_accounts (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null references public.platform_customers(id) on delete cascade,
  provider text not null,
  provider_virtual_account_id text not null,
  source_currency text not null,
  source_rail text,
  destination_currency text not null,
  destination_rail text not null,
  destination_address text not null,
  status text not null
    check (status in ('pending', 'active', 'suspended', 'closed')),
  deposit_instructions jsonb not null default '{}'::jsonb,
  fee_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_virtual_account_id)
);

create index virtual_accounts_tenant_customer_idx
  on public.virtual_accounts (tenant_id, customer_id, created_at desc);

create table public.quotes (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null references public.platform_customers(id) on delete cascade,
  kind text not null check (kind in ('onramp', 'offramp')),
  source_currency text not null,
  source_rail text not null,
  destination_currency text not null,
  destination_rail text not null,
  gross_amount numeric(36, 18) not null check (gross_amount > 0),
  provider_fee numeric(36, 18) not null default 0 check (provider_fee >= 0),
  platform_fee numeric(36, 18) not null default 0 check (platform_fee >= 0),
  network_fee numeric(36, 18) not null default 0 check (network_fee >= 0),
  destination_amount numeric(36, 18) not null check (destination_amount > 0),
  fee_currency text not null,
  status text not null default 'open'
    check (status in ('open', 'processing', 'consumed', 'expired', 'canceled')),
  pricing_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quotes_tenant_customer_idx
  on public.quotes (tenant_id, customer_id, created_at desc);
create index quotes_expiry_idx
  on public.quotes (status, expires_at);

create table public.transfers (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null references public.platform_customers(id) on delete cascade,
  quote_id text not null references public.quotes(id),
  external_id text,
  client_reference_id text not null,
  provider text not null,
  provider_transfer_id text,
  kind text not null check (kind in ('onramp', 'offramp')),
  status text not null check (status in (
    'created', 'awaiting_funds', 'funds_received', 'in_review',
    'payment_submitted', 'payment_processed', 'failed',
    'returned', 'refunded', 'canceled'
  )),
  source jsonb not null,
  destination jsonb not null,
  gross_amount numeric(36, 18) not null,
  provider_fee numeric(36, 18) not null default 0,
  platform_fee numeric(36, 18) not null default 0,
  network_fee numeric(36, 18) not null default 0,
  destination_amount numeric(36, 18) not null,
  currency text not null,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_id),
  unique (provider, provider_transfer_id)
);

create index transfers_tenant_customer_idx
  on public.transfers (tenant_id, customer_id, created_at desc);
create index transfers_tenant_status_idx
  on public.transfers (tenant_id, status, updated_at desc);

create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  api_key_id text not null references public.tenant_api_keys(id) on delete cascade,
  idempotency_key text not null,
  method text not null,
  path text not null,
  request_hash text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  response_status integer,
  response_body jsonb,
  operation_ref text,
  error_code text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (api_key_id, idempotency_key)
);

create index api_idempotency_expiry_idx
  on public.api_idempotency_keys (expires_at);

create table public.api_request_log (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  tenant_id text references public.tenants(id) on delete set null,
  api_key_id text references public.tenant_api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status_code integer not null,
  scope text,
  idempotency_key text,
  ip_address text,
  user_agent text,
  latency_ms integer,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index api_request_log_tenant_created_idx
  on public.api_request_log (tenant_id, created_at desc);

create table public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  payload jsonb not null,
  last_error text,
  next_attempt_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index provider_webhook_retry_idx
  on public.provider_webhook_events (status, next_attempt_at);

create table public.tenant_webhook_endpoints (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  url text not null,
  secret_ciphertext text not null,
  subscribed_events text[] not null default array[]::text[],
  status text not null default 'active'
    check (status in ('active', 'disabled', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_outbox (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  endpoint_id text not null references public.tenant_webhook_endpoints(id) on delete cascade,
  event_type text not null,
  resource_id text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_outbox_delivery_idx
  on public.webhook_outbox (status, next_attempt_at);

create table public.ledger_transactions (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  transfer_id text references public.transfers(id),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_transaction_id text not null references public.ledger_transactions(id) on delete cascade,
  tenant_id text not null references public.tenants(id) on delete cascade,
  account_code text not null,
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric(36, 18) not null check (amount > 0),
  currency text not null,
  created_at timestamptz not null default now()
);

create index ledger_entries_tenant_created_idx
  on public.ledger_entries (tenant_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text references public.tenants(id) on delete set null,
  actor_type text not null,
  actor_id text,
  action text not null,
  resource_type text,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_created_idx
  on public.audit_events (tenant_id, created_at desc);

-- No client-side policies are created. These tables are service-role only.
alter table public.tenants enable row level security;
alter table public.tenant_provider_configs enable row level security;
alter table public.tenant_api_keys enable row level security;
alter table public.api_nonces enable row level security;
alter table public.platform_customers enable row level security;
alter table public.kyc_sessions enable row level security;
alter table public.virtual_accounts enable row level security;
alter table public.quotes enable row level security;
alter table public.transfers enable row level security;
alter table public.api_idempotency_keys enable row level security;
alter table public.api_request_log enable row level security;
alter table public.provider_webhook_events enable row level security;
alter table public.tenant_webhook_endpoints enable row level security;
alter table public.webhook_outbox enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_events enable row level security;

insert into public.tenants (id, name, status, environment)
values ('ten_test_local', 'Local Sandbox', 'sandbox', 'sandbox')
on conflict (id) do nothing;

insert into public.tenant_provider_configs (
  tenant_id, provider, status, approval_status, metadata
)
values (
  'ten_test_local', 'mock', 'sandbox', 'approved',
  '{"purpose":"development only"}'::jsonb
)
on conflict (tenant_id, provider) do nothing;

-- mk_test_local. The HMAC secret is held in the BOOTSTRAP_API_SECRET
-- Edge Function secret and never stored in this migration.
insert into public.tenant_api_keys (
  id,
  tenant_id,
  name,
  key_hash,
  key_prefix,
  secret_ciphertext,
  scopes
)
values (
  'key_test_local',
  'ten_test_local',
  'Local development key',
  encode(digest('mk_test_local', 'sha256'), 'hex'),
  'mk_test_local',
  'env:BOOTSTRAP_API_SECRET',
  array[
    'customers:read',
    'customers:write',
    'kyc:write',
    'virtual_accounts:read',
    'virtual_accounts:write',
    'quotes:write',
    'transfers:read',
    'transfers:write'
  ]::text[]
)
on conflict (id) do nothing;
