-- State tracking and reconciliation primitives for tenant/customer money flow.
-- Core rows already carry tenant_id/customer_id; these tables make lifecycle
-- transitions and provider reconciliation explicit and queryable.

alter table public.platform_customers
  add column if not exists provider_status_raw text,
  add column if not exists last_provider_sync_at timestamptz,
  add column if not exists kyc_started_at timestamptz,
  add column if not exists kyc_active_at timestamptz,
  add column if not exists kyc_rejected_at timestamptz;

alter table public.kyc_sessions
  add column if not exists tos_status text not null default 'pending'
    check (tos_status in ('not_required', 'pending', 'accepted')),
  add column if not exists tos_url_issued_at timestamptz,
  add column if not exists kyc_url_issued_at timestamptz,
  add column if not exists provider_status_raw text,
  add column if not exists last_provider_sync_at timestamptz;

alter table public.virtual_accounts
  add column if not exists provider_status_raw text,
  add column if not exists last_provider_sync_at timestamptz;

alter table public.quotes
  add column if not exists processing_at timestamptz,
  add column if not exists consumed_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists canceled_at timestamptz;

alter table public.transfers
  add column if not exists provider_status_raw text,
  add column if not exists last_provider_sync_at timestamptz,
  add column if not exists reconciliation_status text not null default 'unreconciled'
    check (reconciliation_status in ('unreconciled', 'matched', 'mismatch', 'orphaned', 'ignored')),
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_details jsonb not null default '{}'::jsonb;

create table if not exists public.platform_state_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  resource_type text not null check (
    resource_type in ('customer', 'kyc_session', 'virtual_account', 'quote', 'transfer', 'ledger_transaction')
  ),
  resource_id text not null,
  previous_status text,
  next_status text not null,
  source text not null check (
    source in ('api', 'dashboard', 'provider', 'provider_webhook', 'reconciliation', 'system')
  ),
  provider text,
  provider_resource_id text,
  request_id text,
  idempotency_key text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_state_events_resource_idx
  on public.platform_state_events (tenant_id, resource_type, resource_id, created_at desc);

create index if not exists platform_state_events_created_idx
  on public.platform_state_events (tenant_id, created_at desc);

create table if not exists public.reconciliation_runs (
  id text primary key,
  tenant_id text references public.tenants(id) on delete cascade,
  provider text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  checked_count integer not null default 0 check (checked_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  mismatch_count integer not null default 0 check (mismatch_count >= 0),
  orphaned_count integer not null default 0 check (orphaned_count >= 0),
  details jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reconciliation_runs_tenant_created_idx
  on public.reconciliation_runs (tenant_id, created_at desc);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.reconciliation_runs(id) on delete cascade,
  tenant_id text references public.tenants(id) on delete cascade,
  resource_type text not null check (
    resource_type in ('customer', 'kyc_session', 'virtual_account', 'quote', 'transfer', 'ledger_transaction')
  ),
  resource_id text,
  provider text not null,
  provider_resource_id text,
  status text not null check (status in ('matched', 'mismatch', 'orphaned', 'ignored')),
  expected jsonb not null default '{}'::jsonb,
  actual jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists reconciliation_items_run_idx
  on public.reconciliation_items (run_id, status);

create index if not exists reconciliation_items_resource_idx
  on public.reconciliation_items (tenant_id, resource_type, resource_id);

create index if not exists transfers_reconciliation_idx
  on public.transfers (tenant_id, reconciliation_status, updated_at desc);

create or replace view public.transfer_ownership_reconciliation as
select
  t.id as transfer_id,
  t.tenant_id,
  t.customer_id,
  c.external_id as customer_external_id,
  c.provider_customer_id,
  t.quote_id,
  t.provider,
  t.provider_transfer_id,
  t.client_reference_id,
  t.status as transfer_status,
  t.reconciliation_status,
  t.reconciled_at,
  (c.tenant_id = t.tenant_id) as customer_tenant_match,
  (q.tenant_id = t.tenant_id) as quote_tenant_match,
  (q.customer_id = t.customer_id) as quote_customer_match,
  coalesce(l.total_debit, 0) = coalesce(l.total_credit, 0) as platform_fee_ledger_balanced,
  coalesce(l.ledger_transaction_count, 0) as ledger_transaction_count,
  t.gross_amount,
  t.platform_fee,
  t.currency,
  t.reconciliation_details,
  t.created_at,
  t.updated_at
from public.transfers t
join public.platform_customers c
  on c.id = t.customer_id
join public.quotes q
  on q.id = t.quote_id
left join (
  select
    lt.transfer_id,
    count(distinct lt.id) as ledger_transaction_count,
    sum(case when le.direction = 'debit' then le.amount else 0 end) as total_debit,
    sum(case when le.direction = 'credit' then le.amount else 0 end) as total_credit
  from public.ledger_transactions lt
  join public.ledger_entries le
    on le.ledger_transaction_id = lt.id
  group by lt.transfer_id
) l
  on l.transfer_id = t.id;

alter table public.platform_state_events enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;

comment on table public.platform_state_events is
  'Append-only lifecycle events for tenant-scoped Universa resources. Used to answer what changed, when, and from which request/provider event.';

comment on table public.reconciliation_runs is
  'Provider reconciliation job summaries. Runs may be tenant-specific or platform-wide.';

comment on table public.reconciliation_items is
  'Per-resource reconciliation results comparing provider state against Universa tenant/customer/transfer records.';

comment on column public.transfers.reconciliation_status is
  'Current provider reconciliation result for this transfer. matched means provider state agrees with tenant/customer/amount/route.';

comment on view public.transfer_ownership_reconciliation is
  'Operator view for verifying transfer ownership joins and double-entry platform fee balance.';
