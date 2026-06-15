import { hmacSha256Hex } from './crypto.ts'
import { ApiError, requireString } from './errors.ts'

export const WEBHOOK_RESOURCE_TYPES = [
  'customer',
  'customer_wallet',
  'kyc_session',
  'virtual_account',
  'quote',
  'transfer',
  'ledger_transaction',
] as const

export const WEBHOOK_EVENT_TYPES = [
  ...WEBHOOK_RESOURCE_TYPES.flatMap((resourceType) => [
    `${resourceType}.created`,
    `${resourceType}.status_changed`,
  ]),
  'webhook.test',
]

export const DEFAULT_WEBHOOK_SUBSCRIPTIONS = [
  'customer.*',
  'customer_wallet.*',
  'kyc_session.*',
  'virtual_account.*',
  'quote.*',
  'transfer.*',
  'webhook.test',
]

export const MAX_WEBHOOK_ATTEMPTS = 10

export type WebhookResourceType = typeof WEBHOOK_RESOURCE_TYPES[number]

export function webhookEventType(
  resourceType: WebhookResourceType,
  previousStatus: string | null,
): string {
  return `${resourceType}.${previousStatus === null ? 'created' : 'status_changed'}`
}

export function webhookEventPayload(input: {
  id: string
  type: string
  createdAt: string
  livemode: boolean
  tenantId: string
  object: Record<string, unknown>
}): Record<string, unknown> {
  return {
    id: input.id,
    type: input.type,
    created_at: input.createdAt,
    livemode: input.livemode,
    tenant_id: input.tenantId,
    data: {
      object: input.object,
    },
  }
}

export function normalizeWebhookSubscriptions(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_WEBHOOK_SUBSCRIPTIONS]
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', 'subscribed_events must be an array')
  }
  if (!value.length) {
    throw new ApiError(400, 'invalid_request', 'at least one subscribed event is required')
  }
  if (value.length > 25) {
    throw new ApiError(400, 'invalid_request', 'too many subscribed events')
  }

  const subscriptions = value.map((event) =>
    requireString(event, 'subscribed_event', {
      max: 80,
      pattern: /^(\*|[a-z_]+(\.\*|\.[a-z_]+)?)$/,
    })
  )
  for (const event of subscriptions) {
    if (!isAllowedWebhookSubscription(event)) {
      throw new ApiError(400, 'invalid_webhook_event', `${event} is not an allowed webhook event`)
    }
  }
  return [...new Set(subscriptions)]
}

export function matchesWebhookSubscription(
  subscribedEvents: unknown,
  eventType: string,
): boolean {
  const events = Array.isArray(subscribedEvents)
    ? subscribedEvents.map((event) => String(event))
    : []
  if (!events.length) return true
  return events.some((subscription) => {
    if (subscription === '*') return true
    if (subscription === eventType) return true
    if (subscription.endsWith('.*')) {
      return eventType.startsWith(`${subscription.slice(0, -2)}.`)
    }
    return false
  })
}

export function webhookSignaturePayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

export async function signWebhookPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  return hmacSha256Hex(secret, webhookSignaturePayload(timestamp, rawBody))
}

export function webhookRetryDelaySeconds(attempts: number): number {
  const normalized = Math.max(0, Math.min(attempts, MAX_WEBHOOK_ATTEMPTS))
  return Math.min(3600, Math.max(30, 30 * (2 ** normalized)))
}

function isAllowedWebhookSubscription(event: string): boolean {
  if (event === '*') return true
  if (WEBHOOK_EVENT_TYPES.includes(event)) return true
  return WEBHOOK_RESOURCE_TYPES.some((resourceType) => event === `${resourceType}.*`)
    || event === 'webhook.*'
}
