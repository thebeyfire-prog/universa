# Universa Webhooks

Universa sends signed outbound webhook events for tenant-scoped state changes. Configure endpoints in the dashboard Webhooks panel.

## Events

Default subscriptions:

- `customer.*`
- `customer_wallet.*`
- `kyc_session.*`
- `virtual_account.*`
- `quote.*`
- `transfer.*`
- `webhook.test`

Exact event names are also supported, including `customer.created`, `customer.status_changed`, `customer_wallet.created`, `transfer.created`, and `transfer.status_changed`. Use `*` only for broad internal tooling.

## Payload

```json
{
  "id": "evt_...",
  "type": "transfer.created",
  "created_at": "2026-06-12T20:00:00.000Z",
  "livemode": false,
  "tenant_id": "ten_...",
  "data": {
    "object": {
      "resource_type": "transfer",
      "resource_id": "tr_...",
      "previous_status": null,
      "status": "awaiting_funds",
      "source": "provider",
      "provider": "mock",
      "provider_resource_id": "mock_tr_...",
      "request_id": "req_...",
      "idempotency_key": "transfer-001",
      "details": {}
    }
  }
}
```

## Headers And Signature

Universa sends:

- `x-universa-delivery-id`
- `x-universa-event-id`
- `x-universa-event-type`
- `x-universa-timestamp`
- `x-universa-signature`

The signature header is `v1=<hex hmac>`.

Verify:

```text
signed_payload = x-universa-timestamp + "." + raw_body
expected = hex(hmac_sha256(webhook_secret, signed_payload))
```

Use the raw request body bytes before JSON parsing. Store webhook secrets server-side only. Secrets are shown once at endpoint creation or rotation.

## Delivery

Any `2xx` response marks the delivery as delivered. Network failures and non-`2xx` responses retry with exponential backoff. After the configured max attempts, the delivery moves to `dead_letter`.

Recent delivery state, attempts, retry timing, and last error are visible in the dashboard Webhooks panel.

## Operations

- Configure `WEBHOOK_DELIVERY_TOKEN` for the `webhook-delivery` Edge Function.
- Schedule the worker with a short interval, for example every minute, and call it with `Authorization: Bearer $WEBHOOK_DELIVERY_TOKEN`.
- Keep webhook handlers idempotent by using `x-universa-event-id` or `x-universa-delivery-id`.
- Acknowledge only after durable processing or queueing in your own system.
- Use GET API endpoints for reconciliation and support lookups.
