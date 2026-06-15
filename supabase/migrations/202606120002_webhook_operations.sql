create index if not exists tenant_webhook_endpoints_tenant_status_idx
  on public.tenant_webhook_endpoints (tenant_id, status, created_at desc);

create index if not exists webhook_outbox_tenant_created_idx
  on public.webhook_outbox (tenant_id, created_at desc);

create index if not exists webhook_outbox_endpoint_created_idx
  on public.webhook_outbox (endpoint_id, created_at desc);
