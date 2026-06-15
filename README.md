# Universa API

Tenant-scoped fiat onramp, offramp, KYC, virtual account, quote, and transfer API.

## Repository layout

- `public/`: Cloudflare Pages landing page and developer dashboard.
- `supabase/functions/`: Edge Functions for the platform API and dashboard API.
- `supabase/migrations/`: Database schema for tenants, API keys, KYC, virtual accounts, quotes, transfers, webhooks, fees, and developer rewards.
- `contracts/kyc-token-vault/`: Solana Anchor program for capped UNV developer reward releases.
- `scripts/universa-token/`: Meteora DBC launch script and token artwork.
- `launch/meteora-dbc/`: DBC curve planning utilities.

## Architecture

- Partner credentials stay inside Supabase Edge Functions.
- Developers authenticate server requests with scoped API keys and HMAC signatures.
- End customers are separate partner records and must reach active KYC before money movement.
- Active customer KYC assigns an immutable Privy Solana server wallet. Virtual accounts settle on-ramp USDC to that wallet by default, and wallet export is brokered with Privy HPKE so Universa never stores plaintext keys.
- POST operations require idempotency keys.
- Platform fees are quoted explicitly and written to a double-entry fee ledger.
- The sandbox uses a deterministic mock partner. Live partner access remains approval-gated.

## Hosted development services

- Site: `https://universa-brm.pages.dev`
- API: `https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api`
- OpenAPI contract: [`openapi.yaml`](./openapi.yaml)
- Webhook guide: [`docs/webhooks.md`](./docs/webhooks.md)
- Production readiness gates: [`docs/production-readiness.md`](./docs/production-readiness.md)
- Solana-native developer rewards design: [`docs/developer-rewards.md`](./docs/developer-rewards.md)
- Meteora DBC launch plan: [`docs/meteora-dbc-launch.md`](./docs/meteora-dbc-launch.md)

## Request signing

Create the following canonical string:

```text
<timestamp_ms>
<nonce>
<HTTP_METHOD>
<path_and_query>
<sha256_hex_of_raw_body>
```

Sign it with `HMAC-SHA256` using the API secret. Send the result as
`X-Universa-Signature` with `X-Universa-Api-Key`, `X-Universa-Timestamp`, and
`X-Universa-Nonce`. The header prefix is `x-universa-*`.

API secrets are returned only when a key is created. They are not browser
credentials and must not be included in frontend applications.

## Webhooks

Developers can create dashboard-managed webhook endpoints, receive a one-time
`whsec_*` signing secret, send test events, rotate secrets, disable endpoints,
and inspect recent delivery history.

Outbound webhook signatures use:

```text
x-universa-signature = "v1=" + hex(hmac_sha256(webhook_secret, x-universa-timestamp + "." + raw_body))
```

The `webhook-delivery` Edge Function delivers due outbox rows, retries failures
with backoff, and dead-letters after the max attempts. Configure
`WEBHOOK_DELIVERY_TOKEN` and schedule the worker with:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/webhook-delivery" \
  -H "authorization: Bearer $WEBHOOK_DELIVERY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"limit":25}'
```

## Development

```bash
npm run check
npm run check:functions
npm run dbc:plan
npm run dev
```

The smoke test reads the ignored `.env.local` file:

```bash
set -a
source .env.local
set +a
npm run smoke
```

## Partner status

Live institutional LPs, partner banks, and regional rail partners are kept
behind the server boundary. Public surfaces should not name actual partners
until there is a signed commercial/compliance approval to do so.

## Supported corridor copy

The landing page now presents the first supported corridors as:

- United States: USD via ACH and wire.
- Brazil: BRL via PIX.
- Mexico: MXN via SPEI.
- Eurozone: EUR via SEPA.
- United Kingdom: GBP via Faster Payments.
- Colombia: COP local routes in controlled rollout.

Public copy avoids naming competitor or partner minimums as verified facts until
there is a public source or a private quote we can legally reference.
