import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticateRequest, requireScope } from '../_shared/auth.ts'
import { randomId } from '../_shared/crypto.ts'
import { ApiError } from '../_shared/errors.ts'
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from '../_shared/idempotency.ts'
import {
  clientIp,
  CORS_HEADERS,
  jsonResponse,
  normalizedApiPath,
  parseJson,
} from '../_shared/http.ts'
import { PlatformService } from '../_shared/service.ts'
import type { RequestContext } from '../_shared/types.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const requestId = randomId('req')
  const startedAt = Date.now()
  let admin: any = null
  let context: RequestContext | null = null
  let idempotencyRowId: string | null = null
  let responseStatus = 500
  let errorCode: string | null = null

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      throw new ApiError(500, 'server_misconfigured', 'Database credentials are not configured')
    }

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const url = new URL(request.url)
    const canonicalPath = normalizedApiPath(url)
    const routePath = canonicalPath.split('?')[0]
    const rawBody = request.method === 'GET' ? '' : await request.text()
    const body = parseJson(rawBody)

    context = await authenticateRequest(admin, request, {
      requestId,
      method: request.method,
      path: canonicalPath,
      rawBody,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent') ?? '',
    })

    const scope = scopeFor(request.method, routePath)
    if (!scope) throw new ApiError(404, 'not_found', 'Route not found')
    requireScope(context, scope)

    if (request.method === 'POST') {
      const idempotency = await beginIdempotentRequest(admin, context)
      if (idempotency.replay) {
        responseStatus = idempotency.status
        await logRequest(admin, context, startedAt, idempotency.status, scope)
        return jsonResponse(idempotency.body, idempotency.status, {
          'X-Universa-Request-Id': requestId,
          'X-Idempotent-Replay': 'true',
        })
      }
      idempotencyRowId = idempotency.rowId
    }

    const service = new PlatformService(admin, context)
    const result = await routeRequest(service, request.method, routePath, body)
    responseStatus = result.status

    if (idempotencyRowId) {
      await completeIdempotentRequest(
        admin,
        idempotencyRowId,
        result.status,
        result.body,
        operationReference(result.body),
      )
    }

    await logRequest(admin, context, startedAt, result.status, scope)
    return jsonResponse(result.body, result.status, {
      'X-Universa-Request-Id': requestId,
    })
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Internal server error')
    responseStatus = apiError.status
    errorCode = apiError.code

    if (!(error instanceof ApiError)) {
      console.error('[platform-api]', requestId, error)
    }
    if (admin && idempotencyRowId) {
      await failIdempotentRequest(admin, idempotencyRowId, apiError.code)
    }
    if (admin && context) {
      await logRequest(
        admin,
        context,
        startedAt,
        apiError.status,
        undefined,
        apiError.code,
      )
    }

    return jsonResponse(
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.details && Deno.env.get('NODE_ENV') !== 'production'
            ? { details: apiError.details }
            : {}),
        },
      },
      apiError.status,
      { 'X-Universa-Request-Id': requestId },
    )
  } finally {
    if (!context && responseStatus >= 500) {
      console.warn('[platform-api] unauthenticated failure', { requestId, errorCode })
    }
  }
})

async function routeRequest(
  service: PlatformService,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (method === 'POST' && path === '/v1/customers') return service.createCustomer(body)
  if (method === 'POST' && path === '/v1/quotes') return service.createQuote(body)
  if (method === 'POST' && path === '/v1/transfers') return service.createTransfer(body)

  const customerMatch = path.match(/^\/v1\/customers\/([^/]+)$/)
  if (method === 'GET' && customerMatch) {
    return service.getCustomer(decodeURIComponent(customerMatch[1]))
  }

  const kycMatch = path.match(/^\/v1\/customers\/([^/]+)\/kyc-sessions$/)
  if (method === 'POST' && kycMatch) {
    return service.createKycSession(decodeURIComponent(kycMatch[1]))
  }

  const walletMatch = path.match(/^\/v1\/customers\/([^/]+)\/wallet$/)
  if (method === 'GET' && walletMatch) {
    return service.getCustomerWallet(decodeURIComponent(walletMatch[1]))
  }

  const walletExportMatch = path.match(/^\/v1\/customers\/([^/]+)\/wallet\/export$/)
  if (method === 'POST' && walletExportMatch) {
    return service.exportCustomerWallet(decodeURIComponent(walletExportMatch[1]), body)
  }

  const virtualAccountMatch = path.match(
    /^\/v1\/customers\/([^/]+)\/virtual-accounts$/,
  )
  if (virtualAccountMatch && method === 'POST') {
    return service.createVirtualAccount(
      decodeURIComponent(virtualAccountMatch[1]),
      body,
    )
  }
  if (virtualAccountMatch && method === 'GET') {
    return service.listVirtualAccounts(decodeURIComponent(virtualAccountMatch[1]))
  }

  const transferMatch = path.match(/^\/v1\/transfers\/([^/]+)$/)
  if (method === 'GET' && transferMatch) {
    return service.getTransfer(decodeURIComponent(transferMatch[1]))
  }

  throw new ApiError(404, 'not_found', 'Route not found')
}

function scopeFor(method: string, path: string): string | null {
  if (method === 'POST' && path === '/v1/customers') return 'customers:write'
  if (method === 'GET' && /^\/v1\/customers\/[^/]+$/.test(path)) {
    return 'customers:read'
  }
  if (method === 'POST' && /^\/v1\/customers\/[^/]+\/kyc-sessions$/.test(path)) {
    return 'kyc:write'
  }
  if (method === 'GET' && /^\/v1\/customers\/[^/]+\/wallet$/.test(path)) {
    return 'customer_wallets:read'
  }
  if (method === 'POST' && /^\/v1\/customers\/[^/]+\/wallet\/export$/.test(path)) {
    return 'customer_wallets:export'
  }
  if (method === 'POST' && /^\/v1\/customers\/[^/]+\/virtual-accounts$/.test(path)) {
    return 'virtual_accounts:write'
  }
  if (method === 'GET' && /^\/v1\/customers\/[^/]+\/virtual-accounts$/.test(path)) {
    return 'virtual_accounts:read'
  }
  if (method === 'POST' && path === '/v1/quotes') return 'quotes:write'
  if (method === 'POST' && path === '/v1/transfers') return 'transfers:write'
  if (method === 'GET' && /^\/v1\/transfers\/[^/]+$/.test(path)) {
    return 'transfers:read'
  }
  return null
}

async function logRequest(
  admin: any,
  context: RequestContext,
  startedAt: number,
  status: number,
  scope?: string,
  errorCode?: string,
): Promise<void> {
  const { error } = await admin.from('api_request_log').insert({
    request_id: context.requestId,
    tenant_id: context.tenant.id,
    api_key_id: context.apiKey.id,
    method: context.method,
    path: context.path,
    status_code: status,
    scope: scope ?? null,
    idempotency_key: context.idempotencyKey,
    ip_address: context.ip || null,
    user_agent: context.userAgent || null,
    latency_ms: Date.now() - startedAt,
    error_code: errorCode ?? null,
  })
  if (error) console.error('[platform-api] request log failed', context.requestId, error)
}

function operationReference(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const object = body as Record<string, any>
  return object.transfer?.id
    ?? object.quote?.id
    ?? object.customer?.id
    ?? object.kyc_session?.id
    ?? object.virtual_account?.id
    ?? null
}
