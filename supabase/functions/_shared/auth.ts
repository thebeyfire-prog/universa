import { ApiError } from './errors.ts'
import { decryptSecret, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from './crypto.ts'
import type { ApiKeyRecord, RequestContext } from './types.ts'

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

export async function authenticateRequest(
  admin: any,
  request: Request,
  input: {
    requestId: string
    method: string
    path: string
    rawBody: string
    ip: string
    userAgent: string
  },
): Promise<RequestContext> {
  const apiKeyValue = header(request, 'x-universa-api-key')
  const timestampRaw = header(request, 'x-universa-timestamp')
  const nonce = header(request, 'x-universa-nonce')
  const signature = header(request, 'x-universa-signature')

  if (!apiKeyValue || !timestampRaw || !nonce || !signature) {
    throw new ApiError(401, 'missing_api_auth', 'Missing API authentication headers')
  }
  if (nonce.length > 200) throw new ApiError(401, 'invalid_nonce', 'API nonce is invalid')

  const timestamp = Number(timestampRaw)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    throw new ApiError(401, 'invalid_timestamp', 'API timestamp is outside the allowed window')
  }

  const keyHash = await sha256Hex(apiKeyValue)
  const { data, error } = await admin
    .from('tenant_api_keys')
    .select('*, tenants!inner(id,name,status,environment,kyb_status,risk_tier)')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error) throw error

  const key = data as ApiKeyRecord | null
  if (!key || key.status !== 'active') {
    throw new ApiError(401, 'invalid_api_key', 'Invalid API key')
  }
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, 'api_key_expired', 'API key expired')
  }
  if (key.tenants.status === 'suspended' || key.tenants.status === 'closed') {
    throw new ApiError(403, 'tenant_unavailable', 'Tenant is not permitted to make API requests')
  }
  if (key.tenants.risk_tier === 'blocked') {
    throw new ApiError(403, 'tenant_blocked', 'Tenant is blocked by risk controls')
  }
  if (key.tenants.environment === 'production' && key.tenants.kyb_status !== 'approved') {
    throw new ApiError(403, 'tenant_kyb_required', 'Production API access requires approved tenant KYB')
  }
  if (!ipAllowed(input.ip, key.ip_allowlist ?? [])) {
    throw new ApiError(403, 'ip_not_allowed', 'IP address is not allowed for this API key')
  }

  const secret = await decryptSecret(key.secret_ciphertext)
  const bodyHash = await sha256Hex(input.rawBody)
  const canonical = [
    timestampRaw,
    nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join('\n')
  const expected = await hmacSha256Hex(secret, canonical)
  if (!timingSafeEqualHex(expected, signature)) {
    throw new ApiError(401, 'bad_signature', 'Invalid API signature')
  }

  const { error: nonceError } = await admin.from('api_nonces').insert({
    api_key_id: key.id,
    nonce,
    timestamp_ms: Math.round(timestamp),
  })
  if (nonceError) {
    if (nonceError.code === '23505') {
      throw new ApiError(401, 'replayed_nonce', 'API nonce has already been used')
    }
    throw nonceError
  }

  await admin
    .from('tenant_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)

  return {
    requestId: input.requestId,
    tenant: key.tenants,
    apiKey: key,
    method: input.method,
    path: input.path,
    rawBody: input.rawBody,
    idempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
    ip: input.ip,
    userAgent: input.userAgent,
  }
}

export function requireScope(context: RequestContext, scope: string): void {
  if (!context.apiKey.scopes.includes(scope)) {
    throw new ApiError(403, 'scope_not_allowed', `API key requires ${scope}`)
  }
}

function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true
  return Boolean(ip) && allowlist.includes(ip)
}

function header(request: Request, ...names: string[]): string {
  for (const name of names) {
    const value = request.headers.get(name)
    if (value) return value.trim()
  }
  return ''
}
