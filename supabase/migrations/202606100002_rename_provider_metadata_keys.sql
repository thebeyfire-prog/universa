update public.tenants
set metadata =
  (coalesce(metadata, '{}'::jsonb) - 'bridge_customer_id' - 'bridge_kyc_status' - 'bridge_status_synced_at')
  || jsonb_strip_nulls(jsonb_build_object(
    'provider_customer_id', coalesce(metadata->>'provider_customer_id', metadata->>'bridge_customer_id'),
    'account_kyc_status', coalesce(metadata->>'account_kyc_status', metadata->>'bridge_kyc_status'),
    'provider_status_synced_at', coalesce(metadata->>'provider_status_synced_at', metadata->>'bridge_status_synced_at')
  ))
where metadata ? 'bridge_customer_id'
   or metadata ? 'bridge_kyc_status'
   or metadata ? 'bridge_status_synced_at';
