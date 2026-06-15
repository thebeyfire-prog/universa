# Production Readiness Gates

This repo contains the API, dashboard, database schema, and webhook delivery path. It is not production-ready for live money movement until these gates are proven with real credentials and operating procedures.

## Rails And Provider Coverage

- Run live or partner-staging tests for every advertised corridor, currency, rail, and customer type.
- Capture provider request IDs, settlement IDs, rail references, and expected timing for each route.
- Block public corridor claims until the corresponding provider account and compliance approval are signed off.

## Reconciliation And Settlement

- Reconcile provider transfer state, settlement reports, bank/rail references, ledger entries, and tenant fee revenue daily.
- Alert on missing settlement, amount mismatch, orphaned provider records, stale `awaiting_funds` transfers, and fee drift.
- Maintain support views for customer, virtual account, quote, transfer, ledger, webhook, and audit history by tenant.

## Compliance Operations

- Define owner queues for KYB/KYC review, enhanced due diligence, sanctions escalation, holds, disputes, returns, refunds, and offboarding.
- Record manual decisions in audit events with actor, reason, evidence link, and expiration/review date where applicable.
- Keep production money movement blocked for tenants without approved KYB and live provider approval.

## Webhooks

- Confirm endpoint CRUD, test event enqueue, signed delivery, retries, dead-lettering, and dashboard history in staging.
- Verify signature handling with raw request bodies in at least one reference consumer.
- Schedule and monitor the `webhook-delivery` Edge Function with `WEBHOOK_DELIVERY_TOKEN`.
- Alert on rising failure rate, dead-letter count, and delivery worker lag.

## API Hardening

- Publish OpenAPI docs, stable error codes, idempotency behavior, rate limits, webhook contracts, and support escalation paths.
- Add request, provider, webhook, ledger, and reconciliation observability with traceable `X-Universa-Request-Id`.
- Define incident severity, rollback, status-page, customer notification, and data correction runbooks.

## Smoke Tests

- Run sandbox and staging smoke tests using real secrets before each production deploy.
- Run negative tests for invalid signatures, stale timestamps, missing idempotency keys, blocked tenants, KYC-incomplete customers, duplicate webhooks, and webhook delivery failures.
- Do not mark a release production-ready until live/staging smoke evidence is attached to the release record.
