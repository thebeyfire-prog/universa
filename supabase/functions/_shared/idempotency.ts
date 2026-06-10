import { ApiError } from './errors.ts'
import { sha256Hex } from './crypto.ts'
import type { RequestContext } from './types.ts'

const STALE_PROCESSING_MS = 10 * 60 * 1000

export type IdempotencyState =
  | { replay: true; status: number; body: unknown }
  | { replay: false; rowId: string }

export async function beginIdempotentRequest(
  admin: any,
  context: RequestContext,
): Promise<IdempotencyState> {
  if (!context.idempotencyKey) {
    throw new ApiError(
      400,
      'idempotency_required',
      'Idempotency-Key header is required for POST requests',
    )
  }
  if (context.idempotencyKey.length > 200) {
    throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key is too long')
  }

  const requestHash = await sha256Hex(
    `${context.method.toUpperCase()}\n${context.path}\n${context.rawBody}`,
  )
  const existing = await readExisting(admin, context)
  if (existing) return resolveExisting(admin, existing, requestHash)

  const { data, error } = await admin
    .from('api_idempotency_keys')
    .insert({
      tenant_id: context.tenant.id,
      api_key_id: context.apiKey.id,
      idempotency_key: context.idempotencyKey,
      method: context.method,
      path: context.path,
      request_hash: requestHash,
      status: 'processing',
    })
    .select('id')
    .single()

  if (!error) return { replay: false, rowId: data.id }
  if (error.code !== '23505') throw error

  const raced = await readExisting(admin, context)
  if (!raced) throw error
  return resolveExisting(admin, raced, requestHash)
}

export async function completeIdempotentRequest(
  admin: any,
  rowId: string,
  responseStatus: number,
  responseBody: unknown,
  operationRef?: string | null,
): Promise<void> {
  const { error } = await admin
    .from('api_idempotency_keys')
    .update({
      status: 'completed',
      response_status: responseStatus,
      response_body: responseBody,
      operation_ref: operationRef ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
  if (error) throw error
}

export async function failIdempotentRequest(
  admin: any,
  rowId: string,
  errorCode: string,
): Promise<void> {
  await admin
    .from('api_idempotency_keys')
    .update({
      status: 'failed',
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
}

async function readExisting(admin: any, context: RequestContext): Promise<any | null> {
  const { data, error } = await admin
    .from('api_idempotency_keys')
    .select('id,request_hash,status,response_status,response_body,updated_at')
    .eq('api_key_id', context.apiKey.id)
    .eq('idempotency_key', context.idempotencyKey)
    .maybeSingle()
  if (error) throw error
  return data
}

async function resolveExisting(
  admin: any,
  existing: any,
  requestHash: string,
): Promise<IdempotencyState> {
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      409,
      'idempotency_conflict',
      'Idempotency-Key was already used with a different request',
    )
  }
  if (
    existing.status === 'completed'
    && existing.response_status
    && existing.response_body !== null
  ) {
    return {
      replay: true,
      status: existing.response_status,
      body: existing.response_body,
    }
  }

  const updatedAt = new Date(existing.updated_at).getTime()
  const isStale = Number.isFinite(updatedAt)
    && Date.now() - updatedAt >= STALE_PROCESSING_MS
  if (existing.status === 'failed' || isStale) {
    const { data, error } = await admin
      .from('api_idempotency_keys')
      .update({
        status: 'processing',
        response_status: null,
        response_body: null,
        operation_ref: null,
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('status', existing.status)
      .eq('updated_at', existing.updated_at)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (data) return { replay: false, rowId: data.id }
  }

  throw new ApiError(
    409,
    'idempotency_in_progress',
    'A request with this Idempotency-Key is already processing',
  )
}
