import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ApiError, requireString } from '../_shared/errors.ts'
import { encryptSecret, randomId, randomToken, sha256Hex } from '../_shared/crypto.ts'
import {
  clientIp,
  CORS_HEADERS,
  jsonResponse,
  parseJson,
} from '../_shared/http.ts'

const ALLOWED_SCOPES = new Set([
  'customers:read',
  'customers:write',
  'kyc:write',
  'virtual_accounts:read',
  'virtual_accounts:write',
  'quotes:write',
  'transfers:read',
  'transfers:write',
])

const DEFAULT_SCOPES = [
  'customers:read',
  'customers:write',
  'kyc:write',
  'virtual_accounts:read',
  'virtual_accounts:write',
  'quotes:write',
  'transfers:read',
  'transfers:write',
]

type DashboardContext = {
  user: {
    id: string
    email: string
  }
  membership: {
    tenant_id: string
    role: string
  }
  tenant: Record<string, any>
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: dashboardCorsHeaders(request) })
  }

  const requestId = randomId('dashreq')

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      throw new ApiError(500, 'server_misconfigured', 'Database credentials are not configured')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const context = await authenticateDashboard(admin, request, supabaseUrl)
    const url = new URL(request.url)
    const path = dashboardPath(url)
    const rawBody = request.method === 'GET' ? '' : await request.text()
    const body = parseJson(rawBody)

    if (request.method === 'GET' && path === '/status') {
      return dashboardJson(request, await dashboardStatus(admin, context), 200, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/status/sync') {
      return dashboardJson(request, await syncProviderStatus(admin, context, requestId), 200, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/api-keys') {
      return dashboardJson(request, await createApiKey(admin, context, body, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    const apiKeyMatch = path.match(/^\/api-keys\/([^/]+)$/)
    if (request.method === 'DELETE' && apiKeyMatch) {
      return dashboardJson(
        request,
        await revokeApiKey(admin, context, decodeURIComponent(apiKeyMatch[1]), request),
        200,
        { 'X-Universa-Request-Id': requestId },
      )
    }

    throw new ApiError(404, 'not_found', 'Route not found')
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Internal server error')
    if (!(error instanceof ApiError)) {
      console.error('[dashboard-api]', requestId, error)
    }
    return dashboardJson(
      request,
      { error: { code: apiError.code, message: apiError.message } },
      apiError.status,
      { 'X-Universa-Request-Id': requestId },
    )
  }
})

function dashboardJson(
  request: Request,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, status, {
    ...dashboardCorsHeaders(request),
    ...headers,
  })
}

function dashboardCorsHeaders(request: Request): Record<string, string> {
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin(request.headers.get('origin')),
    Vary: 'Origin',
  }
}

function allowedOrigin(origin: string | null): string {
  const normalized = origin ?? ''
  if (
    normalized === 'https://universa-brm.pages.dev'
    || normalized === 'https://universarails.xyz'
    || normalized === 'https://www.universarails.xyz'
    || /^https:\/\/[a-z0-9-]+\.universa-brm\.pages\.dev$/.test(normalized)
    || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(normalized)
  ) {
    return normalized
  }
  return 'https://universarails.xyz'
}

async function authenticateDashboard(
  admin: any,
  request: Request,
  supabaseUrl: string,
): Promise<DashboardContext> {
  const token = bearerToken(request)
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!token || !anonKey) {
    throw new ApiError(401, 'unauthorized', 'Dashboard authentication is required')
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await authClient.auth.getUser()
  if (error || !data.user) {
    throw new ApiError(401, 'unauthorized', 'Dashboard authentication is invalid')
  }

  let context = await readDashboardContext(admin, data.user)
  if (!context) {
    await maybeBootstrapDashboardUser(admin, data.user)
    context = await readDashboardContext(admin, data.user)
  }
  if (!context && !(await hasDashboardMembership(admin, data.user))) {
    await provisionDashboardTenant(admin, data.user)
    context = await readDashboardContext(admin, data.user)
  }
  if (!context) {
    throw new ApiError(403, 'no_dashboard_access', 'This user is not mapped to a tenant')
  }
  if (context.tenant.status === 'suspended' || context.tenant.status === 'closed') {
    throw new ApiError(403, 'tenant_unavailable', 'Tenant is not permitted to use the dashboard')
  }
  return context
}

async function readDashboardContext(admin: any, user: any): Promise<DashboardContext | null> {
  const { data, error } = await admin
    .from('tenant_dashboard_users')
    .select(`
      tenant_id,
      role,
      tenant:tenants!inner(
        id,
        name,
        status,
        environment,
        kyb_status,
        risk_tier,
        default_fee_bps,
        metadata
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    if (error.code === '42P01') return null
    throw error
  }
  const row = data?.[0]
  if (!row?.tenant) return null
  return {
    user: { id: user.id, email: user.email ?? '' },
    membership: { tenant_id: row.tenant_id, role: row.role },
    tenant: row.tenant,
  }
}

async function hasDashboardMembership(admin: any, user: any): Promise<boolean> {
  const { count, error } = await admin
    .from('tenant_dashboard_users')
    .select('tenant_id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if (error) {
    if (error.code === '42P01') return false
    throw error
  }
  return (count ?? 0) > 0
}

async function maybeBootstrapDashboardUser(admin: any, user: any): Promise<void> {
  const tenantId = (Deno.env.get('DASHBOARD_BOOTSTRAP_TENANT_ID') ?? '').trim()
  const allowedEmails = new Set(
    (Deno.env.get('DASHBOARD_BOOTSTRAP_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  const email = String(user.email ?? '').trim().toLowerCase()
  if (!tenantId || !email || !allowedEmails.has(email)) return

  const { error } = await admin.from('tenant_dashboard_users').upsert({
    user_id: user.id,
    tenant_id: tenantId,
    role: 'owner',
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,tenant_id' })
  if (error) throw error
}

async function provisionDashboardTenant(admin: any, user: any): Promise<void> {
  const userId = String(user.id ?? '').trim()
  if (!userId) return

  const email = String(user.email ?? '').trim().toLowerCase()
  const tenantId = `ten_${(await sha256Hex(`dashboard:${userId}`)).slice(0, 24)}`
  const now = new Date().toISOString()
  const metadata: Record<string, unknown> = {
    onboarding_source: 'dashboard_self_signup',
    account_kyc_status: 'not_started',
    dashboard_user_id: userId,
  }
  if (email) metadata.dashboard_email_hash = await sha256Hex(email)

  const { error: tenantError } = await admin.from('tenants').upsert({
    id: tenantId,
    name: dashboardTenantName(user),
    status: 'sandbox',
    environment: 'sandbox',
    kyb_status: 'not_submitted',
    risk_tier: 'sandbox',
    metadata,
    updated_at: now,
  }, { onConflict: 'id' })
  if (tenantError) throw tenantError

  const { error: membershipError } = await admin.from('tenant_dashboard_users').upsert({
    user_id: userId,
    tenant_id: tenantId,
    role: 'owner',
    status: 'active',
    updated_at: now,
  }, { onConflict: 'user_id,tenant_id' })
  if (membershipError) throw membershipError

  const { error: providerError } = await admin.from('tenant_provider_configs').upsert({
    tenant_id: tenantId,
    provider: 'mock',
    status: 'sandbox',
    approval_status: 'approved',
    metadata: { purpose: 'developer sandbox' },
    updated_at: now,
  }, { onConflict: 'tenant_id,provider' })
  if (providerError) throw providerError

  const { error: auditError } = await admin.from('audit_events').insert({
    tenant_id: tenantId,
    actor_type: 'dashboard_user',
    actor_id: userId,
    action: 'dashboard.tenant_auto_provisioned',
    resource_type: 'tenant',
    resource_id: tenantId,
    details: {
      onboarding_source: 'dashboard_self_signup',
      email_present: Boolean(email),
    },
  })
  if (auditError) console.error('[dashboard-api] auto-provision audit failed', auditError)
}

async function dashboardStatus(admin: any, context: DashboardContext): Promise<Record<string, unknown>> {
  const [
    apiKeys,
    customerCount,
    activeCustomerCount,
    virtualAccountCount,
    transferRows,
    webhookCount,
  ] = await Promise.all([
    listApiKeys(admin, context.tenant.id),
    tableCount(admin, 'platform_customers', context.tenant.id),
    tableCount(admin, 'platform_customers', context.tenant.id, { status: 'active' }),
    tableCount(admin, 'virtual_accounts', context.tenant.id),
    listRecentTransfers(admin, context.tenant.id),
    tableCount(admin, 'tenant_webhook_endpoints', context.tenant.id, { status: 'active' }),
  ])

  return {
    account: safeAccount(context),
    api_keys: apiKeys,
    metrics: summarizeMetrics(
      customerCount,
      activeCustomerCount,
      virtualAccountCount,
      webhookCount,
      transferRows,
    ),
    tasks: taskState(context, apiKeys.length, webhookCount),
    endpoints: {
      platform_api_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/platform-api`,
    },
  }
}

async function syncProviderStatus(
  admin: any,
  context: DashboardContext,
  requestId: string,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const providerCustomerId = stringMetadata(context.tenant, 'provider_customer_id')
  if (!providerCustomerId) {
    throw new ApiError(409, 'provider_customer_missing', 'No provider customer is attached to this tenant')
  }

  const partnerApiKey = Deno.env.get('PARTNER_API_KEY') ?? ''
  const partnerApiUrl = Deno.env.get('PARTNER_API_URL') ?? ''
  if (!partnerApiKey || !partnerApiUrl) {
    throw new ApiError(500, 'provider_misconfigured', 'provider credentials are not configured')
  }

  const response = await fetch(`${partnerApiUrl}/customers/${providerCustomerId}`, {
    headers: { 'Api-Key': partnerApiKey, 'Content-Type': 'application/json' },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      response.status >= 500 ? 502 : response.status,
      'provider_request_failed',
      'provider customer status could not be fetched',
    )
  }

  const mapped = normalizeProviderStatus(payload.status ?? payload.kyc_status)
  const metadata = objectValue(context.tenant.metadata)
  const nextMetadata = {
    ...metadata,
    provider_customer_id: providerCustomerId,
    account_kyc_status: mapped,
    provider_status_synced_at: new Date().toISOString(),
  }
  const kybStatus = mapped === 'active'
    ? 'approved'
    : mapped === 'rejected'
      ? 'rejected'
      : context.tenant.kyb_status === 'approved'
        ? 'approved'
        : 'pending'

  const { data, error } = await admin
    .from('tenants')
    .update({
      metadata: nextMetadata,
      kyb_status: kybStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', context.tenant.id)
    .select('id,name,status,environment,kyb_status,risk_tier,default_fee_bps,metadata')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.provider_status_synced', 'tenant', context.tenant.id, {
    request_id: requestId,
    provider_status: payload.status ?? payload.kyc_status ?? null,
    mapped_status: mapped,
  })

  const nextContext = { ...context, tenant: data }
  return dashboardStatus(admin, nextContext)
}

async function createApiKey(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  if (context.tenant.risk_tier === 'blocked') {
    throw new ApiError(403, 'tenant_blocked', 'Tenant is blocked by risk controls')
  }
  if (!isAccountApproved(context.tenant)) {
    throw new ApiError(403, 'kyc_required', 'Account KYC must be active before creating API keys')
  }

  const activeKeyCount = await tableCount(admin, 'tenant_api_keys', context.tenant.id, {
    status: 'active',
  })
  if (activeKeyCount >= 10) {
    throw new ApiError(409, 'api_key_limit_reached', 'Revoke an existing key before creating another one')
  }

  const name = optionalString(body.name, 'Default server key', 80)
  const scopes = readScopes(body.scopes)
  const environmentPrefix = context.tenant.environment === 'production' ? 'live' : 'test'
  const apiKey = randomToken(`mk_${environmentPrefix}`, 24)
  const apiSecret = randomToken(`ms_${environmentPrefix}`, 32)
  const keyHash = await sha256Hex(apiKey)
  const secretCiphertext = await encryptSecret(apiSecret)
  const keyPrefix = apiKey.slice(0, 20)

  const { data, error } = await admin
    .from('tenant_api_keys')
    .insert({
      id: randomId('key'),
      tenant_id: context.tenant.id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      secret_ciphertext: secretCiphertext,
      scopes,
      ip_allowlist: readIpAllowlist(body.ip_allowlist),
      status: 'active',
    })
    .select('id,name,key_prefix,scopes,status,created_at')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.api_key_created', 'api_key', data.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    scopes,
  })

  return {
    api_key: {
      ...data,
      api_key: apiKey,
      secret: apiSecret,
    },
  }
}

async function revokeApiKey(
  admin: any,
  context: DashboardContext,
  keyIdValue: string,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const keyId = requireString(keyIdValue, 'api_key_id', {
    max: 80,
    pattern: /^key_[A-Za-z0-9_-]+$/,
  })
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tenant_api_keys')
    .update({
      status: 'revoked',
      revoked_at: now,
    })
    .eq('tenant_id', context.tenant.id)
    .eq('id', keyId)
    .eq('status', 'active')
    .select('id,name,key_prefix,scopes,status,last_used_at,created_at,revoked_at')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new ApiError(404, 'api_key_not_found', 'Active API key not found')
  }

  await audit(admin, context, 'dashboard.api_key_revoked', 'api_key', keyId, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
  })

  return { api_key: data }
}

async function listApiKeys(admin: any, tenantId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('tenant_api_keys')
    .select('id,name,key_prefix,scopes,status,last_used_at,created_at,revoked_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data ?? []
}

async function tableCount(
  admin: any,
  table: string,
  tenantId: string,
  equals: Record<string, string> = {},
): Promise<number> {
  let query = admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  for (const [column, value] of Object.entries(equals)) query = query.eq(column, value)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

async function listRecentTransfers(admin: any, tenantId: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await admin
    .from('transfers')
    .select('id,status,gross_amount,platform_fee,tenant_fee,currency,created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return data ?? []
}

function summarizeMetrics(
  customerCount: number,
  activeCustomerCount: number,
  virtualAccountCount: number,
  webhookCount: number,
  transfers: Array<Record<string, any>>,
): Record<string, unknown> {
  const volumeByCurrency: Record<string, number> = {}
  let tenantFees = 0
  let platformFees = 0
  for (const transfer of transfers) {
    const currency = String(transfer.currency ?? 'usd').toLowerCase()
    volumeByCurrency[currency] = (volumeByCurrency[currency] ?? 0) + Number(transfer.gross_amount ?? 0)
    tenantFees += Number(transfer.tenant_fee ?? 0)
    platformFees += Number(transfer.platform_fee ?? 0)
  }
  return {
    customers: customerCount,
    active_customers: activeCustomerCount,
    virtual_accounts: virtualAccountCount,
    transfers: transfers.length,
    active_webhooks: webhookCount,
    volume_by_currency: volumeByCurrency,
    tenant_fees: tenantFees,
    platform_fees: platformFees,
  }
}

function taskState(
  context: DashboardContext,
  apiKeyCount: number,
  webhookCount: number,
): Array<Record<string, unknown>> {
  return [
    {
      id: 'account_kyc',
      label: 'Complete Account KYC',
      status: isAccountApproved(context.tenant) ? 'complete' : accountKycStatus(context.tenant),
    },
    {
      id: 'api_key',
      label: 'Create API key',
      status: apiKeyCount > 0 ? 'complete' : 'open',
      locked: !isAccountApproved(context.tenant),
    },
    {
      id: 'webhook',
      label: 'Add webhook endpoint',
      status: webhookCount > 0 ? 'complete' : 'open',
    },
  ]
}

function safeAccount(context: DashboardContext): Record<string, unknown> {
  return {
    tenant_id: context.tenant.id,
    tenant_name: context.tenant.name,
    role: context.membership.role,
    environment: context.tenant.environment,
    tenant_status: context.tenant.status,
    risk_tier: context.tenant.risk_tier,
    kyb_status: context.tenant.kyb_status,
    account_kyc_status: accountKycStatus(context.tenant),
    provider_customer_id: stringMetadata(context.tenant, 'provider_customer_id') || null,
    default_fee_bps: context.tenant.default_fee_bps ?? 0,
  }
}

function dashboardPath(url: URL): string {
  const path = url.pathname
    .replace(/^\/functions\/v1\/dashboard-api/, '')
    .replace(/^\/dashboard-api/, '')
  return path || '/'
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function assertCanMutate(context: DashboardContext): void {
  if (context.membership.role === 'viewer') {
    throw new ApiError(403, 'role_not_allowed', 'Viewer role cannot perform this action')
  }
}

function accountKycStatus(tenant: Record<string, any>): string {
  const metadata = objectValue(tenant.metadata)
  const providerStatus = normalizeProviderStatus(metadata.account_kyc_status)
  if (providerStatus !== 'not_started') return providerStatus
  if (tenant.kyb_status === 'approved') return 'active'
  if (tenant.kyb_status === 'rejected') return 'rejected'
  if (tenant.kyb_status === 'pending') return 'pending'
  return 'not_started'
}

function isAccountApproved(tenant: Record<string, any>): boolean {
  return accountKycStatus(tenant) === 'active' || tenant.kyb_status === 'approved'
}

function normalizeProviderStatus(value: unknown): string {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'active' || status === 'approved') return 'active'
  if (status === 'rejected' || status === 'denied' || status === 'offboarded') return 'rejected'
  if (status === 'not_started') return 'not_started'
  if (status === 'incomplete' || status === 'in_progress' || status.startsWith('awaiting_')) {
    return 'in_progress'
  }
  if (!status) return 'not_started'
  return 'pending'
}

function readScopes(value: unknown): string[] {
  if (value === undefined) return DEFAULT_SCOPES
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', 'scopes must be an array')
  }
  const scopes = value.map((scope) => requireString(scope, 'scope', { max: 80 }))
  if (!scopes.length) throw new ApiError(400, 'invalid_request', 'at least one scope is required')
  for (const scope of scopes) {
    if (!ALLOWED_SCOPES.has(scope)) {
      throw new ApiError(400, 'invalid_scope', `${scope} is not an allowed scope`)
    }
  }
  return [...new Set(scopes)]
}

function readIpAllowlist(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', 'ip_allowlist must be an array')
  }
  return value.map((ip) => requireString(ip, 'ip_allowlist', {
    max: 64,
    pattern: /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
  }))
}

function optionalString(value: unknown, fallback: string, max: number): string {
  if (value === undefined || value === null || value === '') return fallback
  return requireString(value, 'name', { max })
}

function dashboardTenantName(user: any): string {
  const metadata = objectValue(user.user_metadata)
  const rawName = metadata.company_name
    ?? metadata.full_name
    ?? metadata.name
    ?? 'Developer Sandbox'
  const name = String(rawName).trim().replace(/\s+/g, ' ')
  return name.slice(0, 80) || 'Developer Sandbox'
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function stringMetadata(tenant: Record<string, any>, key: string): string {
  const value = objectValue(tenant.metadata)[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function audit(
  admin: any,
  context: DashboardContext,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('audit_events').insert({
    tenant_id: context.tenant.id,
    actor_type: 'dashboard_user',
    actor_id: context.user.id,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    details,
  })
  if (error) console.error('[dashboard-api] audit failed', action, error)
}
