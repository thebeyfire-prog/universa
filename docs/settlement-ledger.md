# Provider Settlement Ledger

Universa records fee obligations per transfer and clears them when a provider
batch payout arrives. This is the batch-settlement workflow for providers like
Bridge when settlement happens once or twice per month.

## Flow

1. A provider-created transfer accrues a ledger transaction:
   - Debit `provider_fee_receivable` for `platform_fee`.
   - Credit `universa_fee_revenue` for `universa_fee`.
   - Credit `tenant_fee_payable` for `tenant_fee`.
2. The transfer enters `settlement_status = pending_provider_settlement`.
3. When the provider payout arrives, run a dry-run allocation:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npm run settlement:plan -- --provider bridge --currency usd --amount 1234.56
```

4. After the allocation matches the bank/provider report, execute it:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npm run settlement:execute -- --provider bridge --currency usd --amount 1234.56 \
  --provider-settlement-id bridge_payout_123 --reserve-bps 500
```

5. Execution creates:
   - `provider_settlement_batches`
   - `provider_settlement_items`
   - Ledger entries debiting `provider_settlement_cash`
   - Ledger entries crediting `provider_fee_receivable`
   - Transfer settlement status updates

## Important Rules

- Dashboard-only transfers with `bridge_submission_status = not_submitted` do
  not accrue provider receivables.
- Do not split provider deposits manually. Allocate them against
  `provider_settlement_obligations`.
- Reserve holdbacks are recorded per settlement item. Tenant payable remains
  a liability until a later tenant payout workflow clears it.
- A settlement amount smaller than outstanding obligations creates partial
  allocations in transfer creation order.
