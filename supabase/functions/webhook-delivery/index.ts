import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret, randomId } from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import { CORS_HEADERS, jsonResponse, parseJson } from '../_shared/http.ts'
import {
  MAX_WEBHOOK_ATTEMPTS,
  signWebhookPayload,
  webhookRetryDelaySeconds,
} from '../_shared/webhooks.ts'

const DEFAULT_BATCH_LIMIT = 25
const DELIVERY_LEASE_SECONDS = 15 * 60

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const requestId = randomId('whdel')
  try {
    requireDeliveryAuth(request)
    if (request.method !== 'POST') {
      throw new ApiError(405, 'method_not_allowed', 'Use POST to run webhook delivery')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      throw new ApiError(500, 'server_misconfigured', 'Database credentials are not configured')
    }

    const rawBody = await request.text()
    const body = parseJson(rawBody)
    const limit = batchLimit(body.limit)
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const result = await deliverDueWebhooks(admin, limit, requestId)
    return jsonResponse(result, 200, { 'X-Universa-Request-Id': requestId })
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Internal server error')
    if (!(error instanceof ApiError)) {
      console.error('[webhook-delivery]', requestId, error)
    }
    return jsonResponse(
      { error: { code: apiError.code, message: apiError.message } },
      apiError.status,
      { 'X-Universa-Request-Id': requestId },
    )
  }
})

async function deliverDueWebhooks(
  admin: any,
  limit: number,
  requestId: string,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('webhook_outbox')
    .select('id,tenant_id,endpoint_id,event_type,payload,status,attempts,next_attempt_at,created_at')
    .in('status', ['pending', 'failed', 'delivering'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const rows = data ?? []
  const results = []
  for (const row of rows) {
    results.push(await deliverWebhook(admin, row, requestId))
  }
  return {
    request_id: requestId,
    scanned: rows.length,
    delivered: results.filter((result) => result.status === 'delivered').length,
    failed: results.filter((result) => result.status === 'failed').length,
    dead_lettered: results.filter((result) => result.status === 'dead_letter').length,
    results,
  }
}

async function deliverWebhook(
  admin: any,
  row: Record<string, any>,
  requestId: string,
): Promise<Record<string, unknown>> {
  const leaseUntil = new Date(Date.now() + DELIVERY_LEASE_SECONDS * 1000).toISOString()
  const { data: leased, error: leaseError } = await admin
    .from('webhook_outbox')
    .update({
      status: 'delivering',
      next_attempt_at: leaseUntil,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .in('status', ['pending', 'failed', 'delivering'])
    .select('id')
    .maybeSingle()
  if (leaseError) throw leaseError
  if (!leased) return { id: row.id, status: 'skipped' }

  const endpoint = await readEndpoint(admin, row.tenant_id, row.endpoint_id)
  if (!endpoint) {
    await markDeadLetter(admin, row, 'Webhook endpoint is not active')
    return { id: row.id, status: 'dead_letter', error: 'Webhook endpoint is not active' }
  }

  const rawBody = JSON.stringify(row.payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const secret = await decryptSecret(endpoint.secret_ciphertext)
  const signature = await signWebhookPayload(secret, timestamp, rawBody)

  let responseStatus = 0
  let responseText = ''
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Universa-Webhooks/1.0',
        'x-universa-delivery-id': row.id,
        'x-universa-event-id': String(row.payload?.id ?? row.id),
        'x-universa-event-type': row.event_type,
        'x-universa-request-id': requestId,
        'x-universa-signature': `v1=${signature}`,
        'x-universa-timestamp': timestamp,
      },
      body: rawBody,
    })
    responseStatus = response.status
    responseText = await response.text().catch(() => '')
    if (response.ok) {
      await markDelivered(admin, row)
      return { id: row.id, status: 'delivered', response_status: responseStatus }
    }
  } catch (error) {
    responseText = error instanceof Error ? error.message : 'Webhook delivery failed'
  }

  const message = responseStatus
    ? `HTTP ${responseStatus}${responseText ? `: ${responseText.slice(0, 300)}` : ''}`
    : responseText
  return markRetryOrDeadLetter(admin, row, message)
}

async function readEndpoint(
  admin: any,
  tenantId: string,
  endpointId: string,
): Promise<Record<string, any> | null> {
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .select('id,tenant_id,url,secret_ciphertext,status')
    .eq('tenant_id', tenantId)
    .eq('id', endpointId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function markDelivered(admin: any, row: Record<string, any>): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await admin
    .from('webhook_outbox')
    .update({
      status: 'delivered',
      attempts: Number(row.attempts ?? 0) + 1,
      delivered_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq('id', row.id)
  if (error) throw error
}

async function markRetryOrDeadLetter(
  admin: any,
  row: Record<string, any>,
  message: string,
): Promise<Record<string, unknown>> {
  const attempts = Number(row.attempts ?? 0) + 1
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) {
    await markDeadLetter(admin, row, message, attempts)
    return { id: row.id, status: 'dead_letter', attempts, error: message }
  }

  const nextAttemptAt = new Date(Date.now() + webhookRetryDelaySeconds(attempts) * 1000).toISOString()
  const { error } = await admin
    .from('webhook_outbox')
    .update({
      status: 'failed',
      attempts,
      next_attempt_at: nextAttemptAt,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  if (error) throw error
  return { id: row.id, status: 'failed', attempts, next_attempt_at: nextAttemptAt, error: message }
}

async function markDeadLetter(
  admin: any,
  row: Record<string, any>,
  message: string,
  attempts = Number(row.attempts ?? 0) + 1,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await admin
    .from('webhook_outbox')
    .update({
      status: 'dead_letter',
      attempts,
      next_attempt_at: now,
      last_error: message.slice(0, 1000),
      updated_at: now,
    })
    .eq('id', row.id)
  if (error) throw error
}

function requireDeliveryAuth(request: Request): void {
  const configured = Deno.env.get('WEBHOOK_DELIVERY_TOKEN') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const token = request.headers.get('x-webhook-delivery-token')?.trim() ?? bearer
  if (!configured && !serviceRole) {
    throw new ApiError(500, 'server_misconfigured', 'Webhook delivery token is not configured')
  }
  if (token && ((configured && token === configured) || (serviceRole && token === serviceRole))) return
  throw new ApiError(401, 'unauthorized', 'Webhook delivery authorization is required')
}

function batchLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_BATCH_LIMIT
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'invalid_request', 'limit must be an integer from 1 to 100')
  }
  return limit
}
