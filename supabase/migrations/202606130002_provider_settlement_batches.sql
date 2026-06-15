-- Provider settlement batches for partner payouts that arrive after transfer
-- activity. This keeps fee receivables, tenant payables, reserves, and cash
-- clearing queryable instead of dividing batch deposits ad hoc.

create table if not exists public.provider_settlement_batches (
  id text primary key,
  provider text not null,
  provider_settlement_id text,
  status text not null default 'draft'
    check (status in (
      'draft', 'received', 'allocated', 'partially_allocated',
      'settled', 'mismatch', 'canceled'
    )),
  currency text not null,
  amount_expected numeric(36, 18) not null default 0 check (amount_expected >= 0),
  amount_received numeric(36, 18) not null default 0 check (amount_received >= 0),
  allocated_amount numeric(36, 18) not null default 0 check (allocated_amount >= 0),
  reserve_amount numeric(36, 18) not null default 0 check (reserve_amount >= 0),
  settlement_period_start timestamptz,
  settlement_period_end timestamptz,
  received_at timestamptz,
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_settlement_id)
);

create table if not exists public.provider_settlement_items (
  id text primary key,
  batch_id text not null references public.provider_settlement_batches(id) on delete cascade,
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text references public.platform_customers(id) on delete set null,
  transfer_id text not null references public.transfers(id) on delete cascade,
  provider text not null,
  provider_transfer_id text,
  kind text not null check (kind in ('onramp', 'offramp')),
  status text not null default 'allocated'
    check (status in ('allocated', 'partially_settled', 'settled', 'held', 'mismatch', 'canceled')),
  gross_amount numeric(36, 18) not null default 0 check (gross_amount >= 0),
  provider_fee_amount numeric(36, 18) not null default 0 check (provider_fee_amount >= 0),
  universa_fee_amount numeric(36, 18) not null default 0 check (universa_fee_amount >= 0),
  tenant_fee_amount numeric(36, 18) not null default 0 check (tenant_fee_amount >= 0),
  platform_fee_amount numeric(36, 18) not null default 0 check (platform_fee_amount >= 0),
  network_fee_amount numeric(36, 18) not null default 0 check (network_fee_amount >= 0),
  amount_expected numeric(36, 18) not null default 0 check (amount_expected >= 0),
  amount_received numeric(36, 18) not null default 0 check (amount_received >= 0),
  reserve_amount numeric(36, 18) not null default 0 check (reserve_amount >= 0),
  currency text not null,
  ledger_transaction_id text references public.ledger_transactions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, transfer_id)
);

alter table public.ledger_transactions
  add column if not exists transaction_type text not null default 'general',
  add column if not exists settlement_batch_id text,
  add column if not exists settlement_item_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.ledger_transactions
    add constraint ledger_transactions_settlement_batch_fk
    foreign key (settlement_batch_id)
    references public.provider_settlement_batches(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ledger_transactions
    add constraint ledger_transactions_settlement_item_fk
    foreign key (settlement_item_id)
    references public.provider_settlement_items(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

alter table public.transfers
  add column if not exists settlement_status text not null default 'unsettled'
    check (settlement_status in (
      'not_applicable', 'not_submitted', 'unsettled',
      'pending_provider_settlement', 'partially_settled',
      'settled', 'held', 'mismatch', 'canceled'
    )),
  add column if not exists settlement_batch_id text,
  add column if not exists settlement_item_id text,
  add column if not exists settled_amount numeric(36, 18) not null default 0 check (settled_amount >= 0),
  add column if not exists settlement_reserved_amount numeric(36, 18) not null default 0 check (settlement_reserved_amount >= 0),
  add column if not exists settled_at timestamptz,
  add column if not exists settlement_details jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.transfers
    add constraint transfers_settlement_batch_fk
    foreign key (settlement_batch_id)
    references public.provider_settlement_batches(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.transfers
    add constraint transfers_settlement_item_fk
    foreign key (settlement_item_id)
    references public.provider_settlement_items(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists provider_settlement_batches_provider_created_idx
  on public.provider_settlement_batches (provider, created_at desc);

create index if not exists provider_settlement_batches_status_idx
  on public.provider_settlement_batches (status, received_at desc);

create index if not exists provider_settlement_items_batch_idx
  on public.provider_settlement_items (batch_id, status);

create index if not exists provider_settlement_items_tenant_idx
  on public.provider_settlement_items (tenant_id, created_at desc);

create index if not exists provider_settlement_items_transfer_idx
  on public.provider_settlement_items (transfer_id, created_at desc);

create index if not exists transfers_settlement_status_idx
  on public.transfers (tenant_id, settlement_status, updated_at desc);

create index if not exists ledger_transactions_settlement_idx
  on public.ledger_transactions (settlement_batch_id, settlement_item_id);

update public.ledger_transactions
set transaction_type = 'transfer_fee_accrual',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('backfilled_type', true)
where transaction_type = 'general'
  and transfer_id is not null
  and description = 'Platform developer fee accrued';

update public.transfers
set settlement_status = case
    when status in ('failed', 'returned', 'refunded', 'canceled') then 'not_applicable'
    when provider = 'dashboard'
      and coalesce(provider_payload->>'bridge_submission_status', '') = 'not_submitted'
      then 'not_submitted'
    when platform_fee > 0 then 'pending_provider_settlement'
    else 'not_applicable'
  end,
  settlement_details = coalesce(settlement_details, '{}'::jsonb)
    || jsonb_build_object('backfilled_at', now())
where settlement_status = 'unsettled';

create or replace view public.provider_settlement_obligations as
select
  t.id as transfer_id,
  t.tenant_id,
  t.customer_id,
  c.external_id as customer_external_id,
  c.email as customer_email,
  t.provider,
  t.provider_transfer_id,
  t.kind,
  t.status as transfer_status,
  t.reconciliation_status,
  t.settlement_status,
  t.gross_amount,
  t.provider_fee,
  t.universa_fee,
  t.tenant_fee,
  t.platform_fee,
  t.network_fee,
  t.currency,
  coalesce(t.settled_amount, 0) as settled_amount,
  coalesce(t.settlement_reserved_amount, 0) as settlement_reserved_amount,
  greatest(t.platform_fee - coalesce(t.settled_amount, 0), 0) as amount_outstanding,
  t.created_at,
  t.updated_at
from public.transfers t
join public.platform_customers c
  on c.id = t.customer_id
where t.platform_fee > 0
  and t.status not in ('failed', 'returned', 'refunded', 'canceled')
  and t.settlement_status in (
    'unsettled', 'pending_provider_settlement', 'partially_settled', 'held'
  )
  and greatest(t.platform_fee - coalesce(t.settled_amount, 0), 0) > 0;

create or replace view public.provider_settlement_batch_summary as
select
  b.id,
  b.provider,
  b.provider_settlement_id,
  b.status,
  b.currency,
  b.amount_expected,
  b.amount_received,
  b.allocated_amount,
  b.reserve_amount,
  count(i.id) as item_count,
  count(i.id) filter (where i.status = 'settled') as settled_item_count,
  count(i.id) filter (where i.status = 'partially_settled') as partially_settled_item_count,
  count(i.id) filter (where i.status = 'held') as held_item_count,
  coalesce(sum(i.amount_received), 0) as item_amount_received,
  coalesce(sum(i.reserve_amount), 0) as item_reserve_amount,
  b.settlement_period_start,
  b.settlement_period_end,
  b.received_at,
  b.settled_at,
  b.created_at,
  b.updated_at
from public.provider_settlement_batches b
left join public.provider_settlement_items i
  on i.batch_id = b.id
group by b.id;

alter table public.provider_settlement_batches enable row level security;
alter table public.provider_settlement_items enable row level security;

comment on table public.provider_settlement_batches is
  'Provider payout batches received by Universa. Used to reconcile batched partner settlement deposits against per-transfer fee receivables.';

comment on table public.provider_settlement_items is
  'Per-transfer allocation rows inside a provider settlement batch. Each row records who the batch money belongs to and how much was held in reserve.';

comment on view public.provider_settlement_obligations is
  'Outstanding transfer fee receivables that should be allocated when a provider settlement batch arrives.';

comment on column public.transfers.settlement_status is
  'Status of Universa/provider fee settlement for this transfer, separate from end-user transfer execution status.';
