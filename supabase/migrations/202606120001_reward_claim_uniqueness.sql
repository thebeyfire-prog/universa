create unique index if not exists developer_reward_claims_epoch_tenant_active_idx
  on public.developer_reward_claims (epoch_id, tenant_id)
  where status in ('submitted', 'confirmed');

comment on index public.developer_reward_claims_epoch_tenant_active_idx is
  'Prevents duplicate active UNV reward release requests for the same tenant and reward epoch.';
