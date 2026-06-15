import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ApiError, requireObject, requireString } from '../_shared/errors.ts'
import { decryptSecret, encryptSecret, randomId, randomToken, sha256Hex } from '../_shared/crypto.ts'
import { dashboardQuoteDestinationAmount } from '../_shared/dashboard_pricing.ts'
import { calculatePricing, quoteExpiry } from '../_shared/pricing.ts'
import {
  clientIp,
  CORS_HEADERS,
  jsonResponse,
  parseJson,
} from '../_shared/http.ts'
import {
  DEFAULT_WEBHOOK_SUBSCRIPTIONS,
  WEBHOOK_EVENT_TYPES,
  matchesWebhookSubscription,
  normalizeWebhookSubscriptions,
  webhookEventPayload,
  webhookEventType,
  type WebhookResourceType,
} from '../_shared/webhooks.ts'

const ALLOWED_SCOPES = new Set([
  'customers:read',
  'customers:write',
  'customer_wallets:read',
  'customer_wallets:export',
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
  'customer_wallets:read',
  'customer_wallets:export',
  'kyc:write',
  'virtual_accounts:read',
  'virtual_accounts:write',
  'quotes:write',
  'transfers:read',
  'transfers:write',
]

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY') ?? ''
const SOLANA_RPC_URLS = Array.from(new Set([
  Deno.env.get('MONET_SOLANA_RPC_URL') ?? '',
  Deno.env.get('SOLANA_RPC_URL') ?? '',
  Deno.env.get('SOLANA_RPC_FALLBACK_URL') ?? '',
  HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` : '',
  'https://api.mainnet-beta.solana.com',
].map((url) => url.trim()).filter(Boolean)))

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

    if (request.method === 'GET' && path === '/webhooks') {
      return dashboardJson(request, await webhookStatus(admin, context), 200, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/webhooks/endpoints') {
      return dashboardJson(request, await createWebhookEndpoint(admin, context, body, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/webhooks/test') {
      return dashboardJson(request, await enqueueTestWebhook(admin, context, body, requestId, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/api-keys') {
      return dashboardJson(request, await createApiKey(admin, context, body, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/payments/quotes') {
      return dashboardJson(request, await createDashboardQuote(admin, context, body, requestId, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/payments/transfers') {
      return dashboardJson(request, await createDashboardTransfer(admin, context, body, requestId, request), 201, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'GET' && path === '/rewards') {
      return dashboardJson(request, await rewardsStatus(admin, context), 200, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'GET' && path === '/holdings') {
      return dashboardJson(request, await holdingsStatus(admin, context), 200, {
        'X-Universa-Request-Id': requestId,
        'Cache-Control': 'no-store, no-cache, max-age=0',
      })
    }

    if (request.method === 'POST' && path === '/rewards/wallet') {
      return dashboardJson(request, await assignRewardWallet(admin, context, request), 200, {
        'X-Universa-Request-Id': requestId,
      })
    }

    if (request.method === 'POST' && path === '/rewards/wallet/export') {
      return dashboardJson(request, await exportRewardWalletKey(admin, context, request), 200, {
        'X-Universa-Request-Id': requestId,
        'Cache-Control': 'no-store, no-cache, max-age=0',
      })
    }

    if (request.method === 'POST' && path === '/rewards/claims') {
      return dashboardJson(request, await createRewardClaim(admin, context, body, requestId, request), 201, {
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

    const webhookEndpointRotateMatch = path.match(/^\/webhooks\/endpoints\/([^/]+)\/rotate$/)
    if (request.method === 'POST' && webhookEndpointRotateMatch) {
      return dashboardJson(
        request,
        await rotateWebhookEndpoint(
          admin,
          context,
          decodeURIComponent(webhookEndpointRotateMatch[1]),
          request,
        ),
        200,
        { 'X-Universa-Request-Id': requestId },
      )
    }

    const webhookEndpointMatch = path.match(/^\/webhooks\/endpoints\/([^/]+)$/)
    if (request.method === 'DELETE' && webhookEndpointMatch) {
      return dashboardJson(
        request,
        await disableWebhookEndpoint(admin, context, decodeURIComponent(webhookEndpointMatch[1]), request),
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
  const [apiKeys, customers, webhookCount] = await Promise.all([
    listApiKeys(admin, context.tenant.id),
    listDashboardCustomers(admin, context.tenant.id),
    tableCount(admin, 'tenant_webhook_endpoints', context.tenant.id, { status: 'active' }),
  ])
  const virtualAccounts = await listDashboardVirtualAccounts(admin, context.tenant.id)
  const dashboardCustomers = mergeDashboardCustomersFromVirtualAccounts(customers, virtualAccounts)
  const customerIds = dashboardCustomers.map((customer) => String(customer.id))
  const [transferRows, settlementObligations, settlementBatches] = await Promise.all([
    listRecentTransfers(admin, context.tenant.id, customerIds),
    listSettlementObligations(admin, context.tenant.id),
    listRecentSettlementBatches(admin, context.tenant.id),
  ])
  const activeCustomerCount = dashboardCustomers.filter((customer) => customer.status === 'active').length

  return {
    account: safeAccount(context),
    api_keys: apiKeys,
    metrics: summarizeMetrics(
      dashboardCustomers.length,
      activeCustomerCount,
      virtualAccounts.length,
      webhookCount,
      transferRows,
      settlementObligations,
    ),
    resources: {
      customers: dashboardCustomers,
      virtual_accounts: virtualAccounts,
      transfers: transferRows,
      settlement_obligations: settlementObligations.slice(0, 25),
      settlement_batches: settlementBatches,
    },
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
  const apiKey = randomToken(`unv_${environmentPrefix}`, 24)
  const apiSecret = randomToken(`unv_secret_${environmentPrefix}`, 32)
  const keyHash = await sha256Hex(apiKey)
  const secretCiphertext = await encryptSecret(apiSecret)
  const keyPrefix = apiKey.slice(0, 24)

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

async function createDashboardQuote(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  requestId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  enforceDashboardPaymentGate(context)
  const customerId = requireString(body.customer_id, 'customer_id', {
    max: 100,
    pattern: /^cus_[A-Za-z0-9_-]+$/,
  })
  const customer = await readActivePaymentCustomer(admin, context.tenant.id, customerId)
  const kind = dashboardPaymentKind(body.kind)
  if (kind === 'onramp') {
    throw new ApiError(
      400,
      'onramp_deposit_instructions_only',
      'On-ramp uses virtual account deposit instructions. Use Offramp to quote a wallet-to-bank transfer.',
    )
  }
  const amount = requireString(body.amount, 'amount', {
    max: 40,
    pattern: /^\d{1,18}(\.\d{1,2})?$/,
  })
  const source = requireObject(body.source, 'source')
  const destination = requireObject(body.destination, 'destination')
  const sourceCurrency = dashboardCurrency(source.currency, 'source.currency')
  const sourceRail = dashboardRail(source.payment_rail, 'source.payment_rail')
  const destinationCurrency = dashboardCurrency(destination.currency, 'destination.currency')
  const destinationRail = dashboardRail(destination.payment_rail, 'destination.payment_rail')
  const tenantFeeBps = readDashboardTenantFeeBps(body.tenant_fee_bps, context)
  const pricing = calculatePricing(amount, sourceCurrency, tenantFeeBps)
  const destinationPricing = dashboardQuoteDestinationAmount(
    pricing.destinationAmount,
    sourceCurrency,
    destinationCurrency,
    destinationRail,
  )

  const { data, error } = await admin
    .from('quotes')
    .insert({
      id: randomId('quo'),
      tenant_id: context.tenant.id,
      customer_id: customer.id,
      kind,
      source_currency: sourceCurrency,
      source_rail: sourceRail,
      destination_currency: destinationCurrency,
      destination_rail: destinationRail,
      gross_amount: pricing.grossAmount,
      provider_fee: pricing.providerFee,
      universa_fee: pricing.universaFee,
      tenant_fee: pricing.tenantFee,
      platform_fee: pricing.platformFee,
      network_fee: pricing.networkFee,
      destination_amount: destinationPricing.amount,
      fee_currency: pricing.feeCurrency,
      pricing_version: `${pricing.pricingVersion}${destinationPricing.pricingVersionSuffix}`,
      universa_fee_bps: pricing.universaFeeBps,
      tenant_fee_bps: pricing.tenantFeeBps,
      provider_fee_bps: pricing.providerFeeBps,
      expires_at: quoteExpiry(),
    })
    .select('*')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.quote_created', 'quote', data.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    request_id: requestId,
    customer_id: customer.id,
  })
  await recordDashboardStateEvent(admin, context, 'quote', data.id, null, data.status, requestId, {
    customer_id: customer.id,
    kind,
    source_currency: sourceCurrency,
    source_rail: sourceRail,
    destination_currency: destinationCurrency,
    destination_rail: destinationRail,
    gross_amount: String(data.gross_amount),
    destination_amount: String(data.destination_amount),
  })

  return { quote: publicDashboardQuote(data) }
}

async function createDashboardTransfer(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  requestId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  enforceDashboardPaymentGate(context)
  if (body.confirmed !== true) {
    throw new ApiError(
      400,
      'transfer_confirmation_required',
      'Confirm the transfer before creating it',
    )
  }
  const quoteId = requireString(body.quote_id, 'quote_id', {
    max: 100,
    pattern: /^quo_[A-Za-z0-9_-]+$/,
  })
  const { data: requestedQuote, error: requestedQuoteError } = await admin
    .from('quotes')
    .select('kind')
    .eq('tenant_id', context.tenant.id)
    .eq('id', quoteId)
    .maybeSingle()
  if (requestedQuoteError) throw requestedQuoteError
  if (requestedQuote?.kind === 'onramp') {
    throw new ApiError(
      400,
      'onramp_deposit_instructions_only',
      'On-ramp uses virtual account deposit instructions and cannot be created as a dashboard transfer.',
    )
  }
  const reserveAt = new Date().toISOString()
  const { data: quote, error: reserveError } = await admin
    .from('quotes')
    .update({ status: 'processing', processing_at: reserveAt, updated_at: reserveAt })
    .eq('tenant_id', context.tenant.id)
    .eq('id', quoteId)
    .eq('status', 'open')
    .gt('expires_at', reserveAt)
    .select('*')
    .maybeSingle()
  if (reserveError) throw reserveError
  if (!quote) {
    throw new ApiError(
      409,
      'quote_unavailable',
      'Quote is expired, already consumed, or does not belong to this tenant',
    )
  }

  const customer = await readActivePaymentCustomer(admin, context.tenant.id, quote.customer_id)
  const transferId = randomId('tr')
  const clientReferenceId = `${context.tenant.id}:${transferId}`
  const source = dashboardTransferRoute(body.source, quote.source_currency, quote.source_rail)
  const destination = dashboardTransferRoute(
    body.destination,
    quote.destination_currency,
    quote.destination_rail,
  )
  const wallet = await readActiveUniversaSolanaPaymentWallet(admin, context.tenant.id)
  const walletAddress = String(wallet.wallet_address)
  assertDashboardSolanaWalletRoute(quote, source, destination, walletAddress)
  const virtualAccount = quote.kind === 'onramp'
    ? await readActivePaymentVirtualAccount(
      admin,
      context.tenant.id,
      customer.id,
      firstNonEmptyString(source.virtual_account_id) ?? '',
    )
    : null
  if (virtualAccount) {
    assertDashboardOnrampVirtualAccountRoute(quote, source, virtualAccount, walletAddress)
  }
  const provider = 'dashboard'
  const providerTransferId = randomId('dash_tr')
  const externalId = optionalPaymentExternalId(body.external_id)
  const executionStatus = 'pending_provider_submission'

  try {
    const { data: transfer, error: transferError } = await admin
      .from('transfers')
      .insert({
        id: transferId,
        tenant_id: context.tenant.id,
        customer_id: customer.id,
        quote_id: quote.id,
        external_id: externalId,
        client_reference_id: clientReferenceId,
        provider,
        provider_transfer_id: providerTransferId,
        kind: quote.kind,
        status: 'created',
        source,
        destination,
        gross_amount: quote.gross_amount,
        provider_fee: quote.provider_fee,
        universa_fee: quote.universa_fee,
        tenant_fee: quote.tenant_fee,
        platform_fee: quote.platform_fee,
        network_fee: quote.network_fee,
        destination_amount: quote.destination_amount,
        currency: quote.fee_currency,
        settlement_status: 'not_submitted',
        provider_payload: {
          source: 'dashboard_session',
          execution_status: executionStatus,
          money_movement_status: 'not_submitted',
          bridge_submission_status: 'not_submitted',
          dashboard_user_id: context.user.id,
          request_id: requestId,
          customer_provider: customer.provider,
          provider_customer_id: customer.provider_customer_id,
          wallet_address: walletAddress,
          wallet_provider: wallet.wallet_provider,
          wallet_chain: wallet.chain,
          wallet_custody_model: wallet.custody_model,
          virtual_account_id: virtualAccount?.id ?? null,
          provider_virtual_account_id: virtualAccount?.provider_virtual_account_id ?? null,
        },
        reconciliation_details: {
          source: 'dashboard_session',
          execution_status: executionStatus,
          money_movement_status: 'not_submitted',
          bridge_submission_status: 'not_submitted',
          customer_provider: customer.provider,
          customer_external_id: customer.external_id,
          provider_customer_id: customer.provider_customer_id,
          wallet_address: walletAddress,
          wallet_provider: wallet.wallet_provider,
          wallet_chain: wallet.chain,
          wallet_custody_model: wallet.custody_model,
          virtual_account_id: virtualAccount?.id ?? null,
          provider_virtual_account_id: virtualAccount?.provider_virtual_account_id ?? null,
        },
      })
      .select('*')
      .single()
    if (transferError) throw transferError

    const consumedAt = new Date().toISOString()
    const { error: quoteError } = await admin
      .from('quotes')
      .update({ status: 'consumed', consumed_at: consumedAt, updated_at: consumedAt })
      .eq('tenant_id', context.tenant.id)
      .eq('id', quote.id)
      .eq('status', 'processing')
    if (quoteError) throw quoteError

    await audit(admin, context, 'dashboard.transfer_created', 'transfer', transfer.id, {
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') ?? null,
      request_id: requestId,
      customer_id: customer.id,
      quote_id: quote.id,
    })
    await recordDashboardStateEvent(admin, context, 'quote', quote.id, 'open', 'processing', requestId, {
      customer_id: customer.id,
      transfer_id: transfer.id,
      reserved_at: reserveAt,
    })
    await recordDashboardStateEvent(admin, context, 'quote', quote.id, 'processing', 'consumed', requestId, {
      customer_id: customer.id,
      transfer_id: transfer.id,
      consumed_at: consumedAt,
    })
    await recordDashboardStateEvent(admin, context, 'transfer', transfer.id, null, transfer.status, requestId, {
      customer_id: customer.id,
      quote_id: quote.id,
      provider,
      provider_transfer_id: providerTransferId,
      client_reference_id: clientReferenceId,
      execution_status: executionStatus,
    })

    return {
      quote: publicDashboardQuote({ ...quote, status: 'consumed', consumed_at: consumedAt }),
      transfer: publicDashboardTransfer(transfer),
      status: await dashboardStatus(admin, context),
    }
  } catch (error) {
    const reopenedAt = new Date().toISOString()
    await admin
      .from('quotes')
      .update({ status: 'open', updated_at: reopenedAt })
      .eq('tenant_id', context.tenant.id)
      .eq('id', quote.id)
      .eq('status', 'processing')
    throw error
  }
}

async function webhookStatus(
  admin: any,
  context: DashboardContext,
): Promise<Record<string, unknown>> {
  const [endpoints, deliveries] = await Promise.all([
    listWebhookEndpoints(admin, context.tenant.id),
    listWebhookDeliveries(admin, context.tenant.id),
  ])
  return {
    endpoints,
    deliveries,
    event_types: WEBHOOK_EVENT_TYPES,
    default_events: DEFAULT_WEBHOOK_SUBSCRIPTIONS,
  }
}

async function createWebhookEndpoint(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const activeCount = await tableCount(admin, 'tenant_webhook_endpoints', context.tenant.id, {
    status: 'active',
  })
  if (activeCount >= 20) {
    throw new ApiError(409, 'webhook_endpoint_limit_reached', 'Disable an endpoint before adding another one')
  }

  const url = requireWebhookUrl(body.url, context.tenant.environment)
  const subscribedEvents = normalizeWebhookSubscriptions(body.subscribed_events)
  const duplicate = await readWebhookEndpointByUrl(admin, context.tenant.id, url)
  if (duplicate?.status === 'active') {
    throw new ApiError(409, 'webhook_endpoint_exists', 'An active webhook endpoint already uses this URL')
  }

  const webhookSecret = randomToken('whsec', 32)
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .insert({
      id: randomId('wh'),
      tenant_id: context.tenant.id,
      url,
      secret_ciphertext: await encryptSecret(webhookSecret),
      subscribed_events: subscribedEvents,
      status: 'active',
    })
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.webhook_endpoint_created', 'webhook_endpoint', data.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    subscribed_events: subscribedEvents,
  })

  return {
    endpoint: data,
    webhook_secret: webhookSecret,
    webhooks: await webhookStatus(admin, context),
  }
}

async function rotateWebhookEndpoint(
  admin: any,
  context: DashboardContext,
  endpointIdValue: string,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const endpointId = requireWebhookEndpointId(endpointIdValue)
  const webhookSecret = randomToken('whsec', 32)
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .update({
      secret_ciphertext: await encryptSecret(webhookSecret),
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', context.tenant.id)
    .eq('id', endpointId)
    .eq('status', 'active')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new ApiError(404, 'webhook_endpoint_not_found', 'Active webhook endpoint not found')
  }

  await audit(admin, context, 'dashboard.webhook_endpoint_secret_rotated', 'webhook_endpoint', endpointId, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
  })

  return {
    endpoint: data,
    webhook_secret: webhookSecret,
    webhooks: await webhookStatus(admin, context),
  }
}

async function disableWebhookEndpoint(
  admin: any,
  context: DashboardContext,
  endpointIdValue: string,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const endpointId = requireWebhookEndpointId(endpointIdValue)
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .update({
      status: 'disabled',
      updated_at: now,
    })
    .eq('tenant_id', context.tenant.id)
    .eq('id', endpointId)
    .eq('status', 'active')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new ApiError(404, 'webhook_endpoint_not_found', 'Active webhook endpoint not found')
  }

  await audit(admin, context, 'dashboard.webhook_endpoint_disabled', 'webhook_endpoint', endpointId, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
  })

  return {
    endpoint: data,
    webhooks: await webhookStatus(admin, context),
  }
}

async function enqueueTestWebhook(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  requestId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  const endpointId = typeof body.endpoint_id === 'string' && body.endpoint_id.trim()
    ? requireWebhookEndpointId(body.endpoint_id)
    : null
  const endpoints = endpointId
    ? [await readWebhookEndpoint(admin, context.tenant.id, endpointId)]
    : await listActiveWebhookEndpoints(admin, context.tenant.id)
  const activeEndpoints = endpoints.filter(Boolean)
  if (!activeEndpoints.length) {
    throw new ApiError(409, 'webhook_endpoint_required', 'Add an active webhook endpoint before sending a test event')
  }

  const eventId = randomId('evt')
  const createdAt = new Date().toISOString()
  const payload = webhookEventPayload({
    id: eventId,
    type: 'webhook.test',
    createdAt,
    livemode: context.tenant.environment === 'production',
    tenantId: context.tenant.id,
    object: {
      resource_type: 'webhook_test',
      resource_id: eventId,
      previous_status: null,
      status: 'created',
      source: 'dashboard',
      provider: null,
      provider_resource_id: null,
      request_id: requestId,
      idempotency_key: null,
      details: {
        message: 'Universa webhook test event',
      },
    },
  })
  const rows = activeEndpoints.map((endpoint: Record<string, any>) => ({
    id: randomId('wo'),
    tenant_id: context.tenant.id,
    endpoint_id: endpoint.id,
    event_type: 'webhook.test',
    resource_id: endpoint.id,
    payload,
    status: 'pending',
    attempts: 0,
    next_attempt_at: createdAt,
  }))
  const { data, error } = await admin
    .from('webhook_outbox')
    .insert(rows)
    .select('id,endpoint_id,event_type,resource_id,status,attempts,next_attempt_at,last_error,delivered_at,created_at,updated_at,payload')
  if (error) throw error

  await audit(admin, context, 'dashboard.webhook_test_enqueued', 'webhook_event', eventId, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    endpoint_id: endpointId,
    delivery_count: rows.length,
  })

  return {
    event_id: eventId,
    deliveries: (data ?? []).map(safeWebhookDelivery),
    webhooks: await webhookStatus(admin, context),
  }
}

async function rewardsStatus(
  admin: any,
  context: DashboardContext,
): Promise<Record<string, unknown>> {
  const [wallet, allocations, claims] = await Promise.all([
    readRewardWallet(admin, context.tenant.id),
    listRewardAllocations(admin, context.tenant.id),
    listRewardClaims(admin, context.tenant.id),
  ])
  return {
    account: safeAccount(context),
    reward_wallet: wallet,
    allocations,
    claims,
    summary: summarizeRewards(allocations, claims),
  }
}

async function holdingsStatus(
  admin: any,
  context: DashboardContext,
): Promise<Record<string, unknown>> {
  const wallet = await readRewardWallet(admin, context.tenant.id)
  const walletAddress = String(wallet?.wallet_address ?? '').trim()
  const baseResponse = {
    account: safeAccount(context),
    reward_wallet: wallet,
    holdings: {
      wallet_address: walletAddress || null,
      source: 'solana_rpc',
      updated_at: new Date().toISOString(),
      status: 'wallet_required',
      tokens: {
        usdc: zeroHolding('USDC', SOLANA_USDC_MINT, 6),
        unv: zeroHolding('UNV', UNV_MINT, 6),
      },
      errors: {},
    },
  }

  if (!isActiveUniversaSolanaWallet(wallet) || !SOLANA_ADDRESS_RE.test(walletAddress)) {
    return baseResponse
  }

  try {
    const balances = await readSolanaTokenBalances(walletAddress, [SOLANA_USDC_MINT, UNV_MINT])
    return {
      ...baseResponse,
      holdings: {
        ...baseResponse.holdings,
        status: 'live',
        tokens: {
          usdc: tokenHolding('USDC', SOLANA_USDC_MINT, 6, balances[SOLANA_USDC_MINT]),
          unv: tokenHolding('UNV', UNV_MINT, 6, balances[UNV_MINT]),
        },
      },
    }
  } catch (error) {
    return {
      ...baseResponse,
      holdings: {
        ...baseResponse.holdings,
        status: 'stale',
        errors: { solana: errorMessage(error) },
      },
    }
  }
}

type SolanaTokenAmount = {
  amount: bigint
  decimals: number
}

function zeroHolding(symbol: string, mint: string, decimals: number): Record<string, unknown> {
  return tokenHolding(symbol, mint, decimals)
}

function tokenHolding(
  symbol: string,
  mint: string,
  fallbackDecimals: number,
  balance: SolanaTokenAmount | null = null,
): Record<string, unknown> {
  const amount = balance?.amount ?? 0n
  const decimals = Number.isFinite(balance?.decimals)
    ? Number(balance?.decimals)
    : fallbackDecimals
  const amountString = formatTokenAmountString(amount, decimals)
  const uiAmount = Number(amountString)

  return {
    symbol,
    mint,
    amount_raw: amount.toString(),
    decimals,
    amount: amountString,
    ui_amount: Number.isFinite(uiAmount) ? uiAmount : null,
    ui_amount_string: `${formatTokenDisplayAmount(amountString, symbol)} ${symbol}`,
  }
}

function formatTokenAmountString(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString()
  const sign = amount < 0n ? '-' : ''
  const absolute = amount < 0n ? -amount : amount
  const raw = absolute.toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0'
  const fraction = raw.slice(-decimals).replace(/0+$/, '')
  return `${sign}${fraction ? `${whole}.${fraction}` : whole}`
}

function formatTokenDisplayAmount(amount: string, symbol: string): string {
  const number = Number(amount)
  if (!Number.isFinite(number)) return amount
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: symbol === 'USDC' ? 2 : 0,
    maximumFractionDigits: symbol === 'USDC' ? 2 : 6,
  }).format(number)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Solana balance lookup failed'
}

async function readSolanaTokenBalances(
  owner: string,
  mints: string[],
): Promise<Record<string, SolanaTokenAmount>> {
  const balances: Record<string, SolanaTokenAmount> = {}

  for (const mint of mints) {
    if (!SOLANA_ADDRESS_RE.test(mint)) continue
    const result = await solanaRpc('getTokenAccountsByOwner', [
      owner,
      { mint },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ])

    let amount = 0n
    let decimals = 6
    const accounts = Array.isArray(result?.value) ? result.value : []
    for (const account of accounts) {
      const tokenAmount = account?.account?.data?.parsed?.info?.tokenAmount
      const rawAmount = String(tokenAmount?.amount ?? '0')
      if (/^\d+$/.test(rawAmount)) amount += BigInt(rawAmount)
      if (Number.isInteger(tokenAmount?.decimals)) decimals = Number(tokenAmount.decimals)
    }
    balances[mint] = { amount, decimals }
  }

  return balances
}

async function solanaRpc(method: string, params: unknown[]): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `universa-dashboard-${crypto.randomUUID()}`,
    method,
    params,
  })
  let lastError: unknown = null

  for (const url of SOLANA_RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(`Solana RPC ${response.status}`)
      }
      if (payload?.error) {
        throw new Error(String(payload.error.message ?? 'Solana RPC error'))
      }
      return payload?.result
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Solana RPC unavailable')
}

async function assignRewardWallet(
  admin: any,
  context: DashboardContext,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  if (!isAccountApproved(context.tenant)) {
    throw new ApiError(403, 'kyc_required', 'Account KYC must be active before Universa assigns a reward wallet')
  }

  const existing = await readRewardWallet(admin, context.tenant.id)
  if (
    existing?.status === 'active'
    && existing.wallet_provider === 'universa'
    && existing.custody_model === 'server_wallet'
    && existing.chain === 'solana'
  ) {
    return { reward_wallet: existing, rewards: await rewardsStatus(admin, context), duplicate: true }
  }
  if (existing) {
    throw new ApiError(
      409,
      'reward_wallet_manual_review_required',
      'This tenant already has reward wallet history. Manual review is required before any new reward wallet can be assigned.',
    )
  }

  const wallet = await generateSolanaCustodyWallet()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tenant_reward_wallets')
    .insert({
      tenant_id: context.tenant.id,
      wallet_provider: 'universa',
      wallet_address: wallet.address,
      custody_model: 'server_wallet',
      chain: 'solana',
      wallet_secret_ciphertext: await encryptSecret(wallet.secret),
      status: 'active',
      assigned_at: now,
      assigned_by: context.user.id,
      updated_at: now,
    })
    .select('tenant_id,wallet_provider,wallet_address,custody_model,chain,status,assigned_at,created_at,updated_at')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.reward_wallet_assigned', 'tenant_reward_wallet', context.tenant.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    wallet_provider: 'universa',
    custody_model: 'server_wallet',
    chain: 'solana',
  })

  return { reward_wallet: data, rewards: await rewardsStatus(admin, context) }
}

async function exportRewardWalletKey(
  admin: any,
  context: DashboardContext,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  if (!isAccountApproved(context.tenant)) {
    throw new ApiError(403, 'kyc_required', 'Account KYC must be active before exporting a reward wallet key')
  }

  const wallet = await readRewardWalletSecret(admin, context.tenant.id)
  if (
    !wallet
    || wallet.status !== 'active'
    || wallet.wallet_provider !== 'universa'
    || wallet.custody_model !== 'server_wallet'
    || wallet.chain !== 'solana'
  ) {
    throw new ApiError(409, 'reward_wallet_required', 'An active Universa Solana reward wallet is required before exporting a key')
  }
  const ciphertext = typeof wallet.wallet_secret_ciphertext === 'string'
    ? wallet.wallet_secret_ciphertext
    : ''
  if (!ciphertext) {
    throw new ApiError(409, 'reward_wallet_secret_missing', 'Reward wallet key material is not available for export')
  }

  const secret = parseRewardWalletSecret(await decryptSecret(ciphertext))
  const publicKey = base64UrlToBytes(secret.public_key)
  const privateKeyPkcs8 = base64UrlToBytes(secret.private_key)
  const seed = ed25519SeedFromPkcs8(privateKeyPkcs8)
  if (publicKey.length !== 32 || seed.length !== 32) {
    throw new ApiError(500, 'reward_wallet_secret_invalid', 'Reward wallet key material is invalid')
  }
  if (base58Encode(publicKey) !== wallet.wallet_address) {
    throw new ApiError(500, 'reward_wallet_secret_mismatch', 'Reward wallet key material does not match the assigned address')
  }

  const keypair = new Uint8Array(64)
  keypair.set(seed, 0)
  keypair.set(publicKey, 32)

  await audit(admin, context, 'dashboard.reward_wallet_key_exported', 'tenant_reward_wallet', context.tenant.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    chain: 'solana',
  })

  return {
    reward_wallet: {
      tenant_id: wallet.tenant_id,
      wallet_provider: wallet.wallet_provider,
      wallet_address: wallet.wallet_address,
      custody_model: wallet.custody_model,
      chain: wallet.chain,
      status: wallet.status,
      assigned_at: wallet.assigned_at,
    },
    export: {
      format: 'solana_keypair_base58',
      private_key_base58: base58Encode(keypair),
    },
    reminder: 'Add a small amount of SOL to this wallet before claiming so it can pay Solana network gas.',
  }
}

async function createRewardClaim(
  admin: any,
  context: DashboardContext,
  body: Record<string, unknown>,
  requestId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  assertCanMutate(context)
  if (!isAccountApproved(context.tenant)) {
    throw new ApiError(403, 'kyc_required', 'Account KYC must be active before requesting UNV rewards')
  }

  const allocationId = requireString(body.allocation_id, 'allocation_id', {
    max: 80,
    pattern: /^[0-9a-fA-F-]{36}$/,
  })
  const { data: allocationRow, error: allocationError } = await admin
    .from('developer_reward_allocations')
    .select(`
      id,
      epoch_id,
      tenant_id,
      wallet_address,
      cumulative_token_amount,
      epoch_settled_volume_usd,
      lifetime_settled_volume_usd,
      milestone_label,
      status,
      epoch:developer_reward_epochs(
        id,
        epoch_number,
        status,
        volume_start_at,
        volume_end_at,
        published_at
      )
    `)
    .eq('tenant_id', context.tenant.id)
    .eq('id', allocationId)
    .maybeSingle()
  if (allocationError) throw allocationError
  if (!allocationRow) {
    throw new ApiError(404, 'allocation_not_found', 'Reward allocation not found')
  }
  const allocation = normalizeRewardAllocation(allocationRow)
  if (allocation.status !== 'eligible') {
    throw new ApiError(409, 'allocation_not_claimable', 'This reward allocation is not eligible to claim')
  }
  if (allocation.epoch?.status !== 'published') {
    throw new ApiError(409, 'epoch_not_claimable', 'This reward epoch is not published yet')
  }

  const wallet = await readRewardWallet(admin, context.tenant.id)
  if (!wallet || wallet.status !== 'active') {
    throw new ApiError(409, 'reward_wallet_required', 'Account KYC must be active and a Universa Solana reward wallet must be assigned before claiming UNV')
  }
  if (String(wallet.wallet_address).toLowerCase() !== String(allocation.wallet_address).toLowerCase()) {
    throw new ApiError(409, 'reward_wallet_mismatch', 'The assigned reward wallet does not match this allocation')
  }

  const existing = await readExistingRewardClaim(admin, context.tenant.id, allocation.epoch_id)
  if (existing) {
    return {
      reward_claim: existing,
      allocation,
      duplicate: true,
      rewards: await rewardsStatus(admin, context),
    }
  }

  const { data, error } = await admin
    .from('developer_reward_claims')
    .insert({
      epoch_id: allocation.epoch_id,
      tenant_id: context.tenant.id,
      wallet_address: allocation.wallet_address,
      cumulative_token_amount: allocation.cumulative_token_amount,
      claimed_token_amount: allocation.cumulative_token_amount,
      status: 'submitted',
      metadata: {
        allocation_id: allocation.id,
        requested_by: context.user.id,
        request_id: requestId,
      },
    })
    .select('id,epoch_id,tenant_id,wallet_address,cumulative_token_amount,claimed_token_amount,tx_hash,status,metadata,created_at,updated_at')
    .single()
  if (error) throw error

  await audit(admin, context, 'dashboard.reward_claim_submitted', 'developer_reward_claim', data.id, {
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') ?? null,
    allocation_id: allocation.id,
    epoch_id: allocation.epoch_id,
  })

  return {
    reward_claim: data,
    allocation,
    rewards: await rewardsStatus(admin, context),
  }
}

async function readRewardWallet(admin: any, tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('tenant_reward_wallets')
    .select('tenant_id,wallet_provider,wallet_address,custody_model,chain,status,assigned_at,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    if (error.code === '42P01') return null
    throw error
  }
  return data ?? null
}

async function readRewardWalletSecret(admin: any, tenantId: string): Promise<Record<string, any> | null> {
  const { data, error } = await admin
    .from('tenant_reward_wallets')
    .select('tenant_id,wallet_provider,wallet_address,custody_model,chain,status,assigned_at,wallet_secret_ciphertext')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    if (error.code === '42P01') return null
    throw error
  }
  return data ?? null
}

function parseRewardWalletSecret(raw: string): { public_key: string; private_key: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(500, 'reward_wallet_secret_invalid', 'Reward wallet key material is invalid')
  }
  const value = objectValue(parsed)
  if (
    value.type !== 'solana_ed25519_pkcs8'
    || typeof value.public_key !== 'string'
    || typeof value.private_key !== 'string'
  ) {
    throw new ApiError(500, 'reward_wallet_secret_invalid', 'Reward wallet key material is invalid')
  }
  return {
    public_key: value.public_key,
    private_key: value.private_key,
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function ed25519SeedFromPkcs8(pkcs8: Uint8Array): Uint8Array {
  for (let index = pkcs8.length - 34; index >= 0; index--) {
    if (pkcs8[index] === 0x04 && pkcs8[index + 1] === 0x20) {
      return pkcs8.slice(index + 2, index + 34)
    }
  }
  throw new ApiError(500, 'reward_wallet_secret_invalid', 'Reward wallet key material is invalid')
}

async function generateSolanaCustodyWallet(): Promise<{ address: string; secret: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  const address = base58Encode(publicKey)
  return {
    address,
    secret: JSON.stringify({
      type: 'solana_ed25519_pkcs8',
      public_key: bytesToBase64Url(publicKey),
      private_key: bytesToBase64Url(privateKey),
    }),
  }
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  if (!bytes.length) return ''
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] << 8
      digits[index] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let result = ''
  for (const byte of bytes) {
    if (byte !== 0) break
    result += alphabet[0]
  }
  for (let index = digits.length - 1; index >= 0; index--) {
    result += alphabet[digits[index]]
  }
  return result
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function listRewardAllocations(admin: any, tenantId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('developer_reward_allocations')
    .select(`
      id,
      epoch_id,
      tenant_id,
      wallet_address,
      lifetime_settled_volume_usd,
      epoch_settled_volume_usd,
      cumulative_token_amount,
      milestone_label,
      hold_reason,
      calculation,
      merkle_proof,
      status,
      created_at,
      updated_at,
      epoch:developer_reward_epochs(
        id,
        epoch_number,
        status,
        volume_start_at,
        volume_end_at,
        published_at
      )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return (data ?? []).map(normalizeRewardAllocation)
}

async function listRewardClaims(admin: any, tenantId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('developer_reward_claims')
    .select('id,epoch_id,tenant_id,wallet_address,cumulative_token_amount,claimed_token_amount,tx_hash,status,metadata,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data ?? []
}

async function readExistingRewardClaim(
  admin: any,
  tenantId: string,
  epochId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('developer_reward_claims')
    .select('id,epoch_id,tenant_id,wallet_address,cumulative_token_amount,claimed_token_amount,tx_hash,status,metadata,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .eq('epoch_id', epochId)
    .in('status', ['submitted', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

function summarizeRewards(
  allocations: Array<Record<string, any>>,
  claims: Array<Record<string, any>>,
): Record<string, unknown> {
  const claimedEpochs = new Set(
    claims
      .filter((claim) => ['submitted', 'confirmed'].includes(String(claim.status ?? '')))
      .map((claim) => String(claim.epoch_id ?? '')),
  )
  let eligibleRaw = 0n
  let claimedRaw = 0n
  for (const allocation of allocations) {
    const epochId = String(allocation.epoch_id ?? '')
    const amount = numericBigInt(allocation.cumulative_token_amount)
    if (
      allocation.status === 'eligible'
      && allocation.epoch?.status === 'published'
      && !claimedEpochs.has(epochId)
    ) {
      eligibleRaw += amount
    }
  }
  for (const claim of claims) {
    if (['submitted', 'confirmed'].includes(String(claim.status ?? ''))) {
      claimedRaw += numericBigInt(claim.claimed_token_amount)
    }
  }
  return {
    eligible_token_amount: eligibleRaw.toString(),
    claimed_token_amount: claimedRaw.toString(),
    pending_claims: claims.filter((claim) => claim.status === 'submitted').length,
  }
}

function numericBigInt(value: unknown): bigint {
  const text = String(value ?? '0').replace(/\..*$/, '')
  return /^\d+$/.test(text) ? BigInt(text) : 0n
}

function normalizeRewardAllocation(allocation: Record<string, any>): Record<string, any> {
  const epoch = Array.isArray(allocation.epoch) ? allocation.epoch[0] : allocation.epoch
  return {
    ...allocation,
    epoch: epoch && typeof epoch === 'object' ? epoch : null,
  }
}

async function listWebhookEndpoints(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data ?? []
}

async function listActiveWebhookEndpoints(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data ?? []
}

async function readWebhookEndpoint(
  admin: any,
  tenantId: string,
  endpointId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', endpointId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new ApiError(404, 'webhook_endpoint_not_found', 'Active webhook endpoint not found')
  }
  return data
}

async function readWebhookEndpointByUrl(
  admin: any,
  tenantId: string,
  url: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('tenant_webhook_endpoints')
    .select('id,url,subscribed_events,status,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .eq('url', url)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

async function listWebhookDeliveries(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('webhook_outbox')
    .select('id,endpoint_id,event_type,resource_id,status,attempts,next_attempt_at,last_error,delivered_at,created_at,updated_at,payload')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return (data ?? []).map(safeWebhookDelivery)
}

function safeWebhookDelivery(row: Record<string, any>): Record<string, unknown> {
  const payload = objectValue(row.payload)
  return {
    id: row.id,
    event_id: typeof payload.id === 'string' ? payload.id : row.id,
    endpoint_id: row.endpoint_id,
    event_type: row.event_type,
    resource_id: row.resource_id,
    status: row.status,
    attempts: row.attempts ?? 0,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    delivered_at: row.delivered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function requireWebhookEndpointId(value: string): string {
  return requireString(value, 'webhook_endpoint_id', {
    max: 80,
    pattern: /^wh_[A-Za-z0-9_-]+$/,
  })
}

function requireWebhookUrl(value: unknown, environment: unknown): string {
  const rawUrl = requireString(value, 'url', { max: 2048 })
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ApiError(400, 'invalid_webhook_url', 'Webhook URL must be absolute')
  }
  const isHttps = parsed.protocol === 'https:'
  const isLocalDev = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (!isHttps && !(environment === 'sandbox' && isLocalDev)) {
    throw new ApiError(400, 'invalid_webhook_url', 'Webhook URL must use HTTPS')
  }
  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  return parsed.toString()
}

function enforceDashboardPaymentGate(context: DashboardContext): void {
  assertCanMutate(context)
  if (context.tenant.risk_tier === 'blocked') {
    throw new ApiError(403, 'tenant_blocked', 'Tenant is blocked by risk controls')
  }
  if (!isAccountApproved(context.tenant)) {
    throw new ApiError(403, 'kyc_required', 'Account KYC must be active before creating quotes or transfers')
  }
}

async function readActivePaymentCustomer(
  admin: any,
  tenantId: string,
  customerId: string,
): Promise<Record<string, any>> {
  const { data, error } = await admin
    .from('platform_customers')
    .select('id,external_id,type,full_name,email,country_code,status,provider,provider_customer_id,provider_kyc_status,metadata,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw error
  if (!data || isDashboardHiddenResource(data)) {
    throw new ApiError(404, 'customer_not_found', 'Customer not found')
  }
  if (data.status !== 'active' || normalizeProviderStatus(data.provider_kyc_status) !== 'active') {
    throw new ApiError(409, 'customer_kyc_incomplete', 'Customer must have active KYC before creating quotes or transfers')
  }
  return data
}

async function readActiveUniversaSolanaPaymentWallet(
  admin: any,
  tenantId: string,
): Promise<Record<string, any>> {
  const wallet = await readRewardWallet(admin, tenantId)
  if (!isActiveUniversaSolanaWallet(wallet)) {
    throw new ApiError(
      409,
      'payment_wallet_required',
      'An active Universa Solana wallet is required before creating payment transfers',
    )
  }
  return wallet as Record<string, any>
}

async function readActivePaymentVirtualAccount(
  admin: any,
  tenantId: string,
  customerId: string,
  virtualAccountId: string,
): Promise<Record<string, any>> {
  if (!virtualAccountId) {
    throw new ApiError(
      409,
      'virtual_account_required',
      'An active customer virtual account is required before creating an onramp transfer',
    )
  }
  if (!/^va_[A-Za-z0-9_-]+$/.test(virtualAccountId)) {
    throw new ApiError(400, 'invalid_request', 'source.virtual_account_id must be a Universa virtual account id')
  }
  const { data, error } = await admin
    .from('virtual_accounts')
    .select('id,customer_id,provider,provider_virtual_account_id,source_currency,source_rail,destination_currency,destination_rail,destination_address,status')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('id', virtualAccountId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new ApiError(
      409,
      'virtual_account_required',
      'Selected customer must have an active virtual account before creating an onramp transfer',
    )
  }
  return data
}

function isActiveUniversaSolanaWallet(wallet: Record<string, unknown> | null): boolean {
  return Boolean(
    wallet?.wallet_address
      && wallet.status === 'active'
      && wallet.wallet_provider === 'universa'
      && wallet.custody_model === 'server_wallet'
      && wallet.chain === 'solana',
  )
}

function assertDashboardSolanaWalletRoute(
  quote: Record<string, any>,
  source: Record<string, unknown>,
  destination: Record<string, unknown>,
  walletAddress: string,
): void {
  const kind = String(quote.kind ?? '').toLowerCase()
  if (kind === 'offramp') {
    if (String(quote.source_rail ?? '').toLowerCase() !== 'solana') {
      throw new ApiError(409, 'stale_quote_route', 'Create a fresh quote using the assigned Solana wallet')
    }
    if (String(source.payment_rail ?? '').toLowerCase() !== 'solana') {
      throw new ApiError(409, 'source_wallet_required', 'Offramp transfers must source from the assigned Solana wallet')
    }
    const fromAddress = firstNonEmptyString(source.from_address, source.address)
    if (fromAddress !== walletAddress) {
      throw new ApiError(409, 'source_wallet_mismatch', 'Transfer source must match the assigned Universa Solana wallet')
    }
    source.from_address = walletAddress
    delete source.address
    return
  }

  if (kind === 'onramp') {
    if (String(quote.destination_rail ?? '').toLowerCase() !== 'solana') {
      throw new ApiError(409, 'stale_quote_route', 'Create a fresh quote using the assigned Solana wallet')
    }
    if (String(destination.payment_rail ?? '').toLowerCase() !== 'solana') {
      throw new ApiError(409, 'destination_wallet_required', 'Onramp transfers must settle to the assigned Solana wallet')
    }
    const toAddress = firstNonEmptyString(destination.to_address, destination.address)
    if (toAddress !== walletAddress) {
      throw new ApiError(409, 'destination_wallet_mismatch', 'Transfer destination must match the assigned Universa Solana wallet')
    }
    destination.to_address = walletAddress
    delete destination.address
  }
}

function assertDashboardOnrampVirtualAccountRoute(
  quote: Record<string, any>,
  source: Record<string, unknown>,
  virtualAccount: Record<string, any>,
  walletAddress: string,
): void {
  const sourceCurrency = String(virtualAccount.source_currency ?? '').toLowerCase()
  const sourceRail = String(virtualAccount.source_rail ?? '').toLowerCase()
  const destinationCurrency = String(virtualAccount.destination_currency ?? '').toLowerCase()
  const destinationRail = String(virtualAccount.destination_rail ?? '').toLowerCase()
  if (
    sourceCurrency !== String(quote.source_currency ?? '').toLowerCase()
    || sourceRail !== String(quote.source_rail ?? '').toLowerCase()
    || sourceCurrency !== String(source.currency ?? '').toLowerCase()
    || sourceRail !== String(source.payment_rail ?? '').toLowerCase()
  ) {
    throw new ApiError(409, 'virtual_account_route_mismatch', 'Virtual account source does not match the quote route')
  }
  if (
    destinationCurrency !== String(quote.destination_currency ?? '').toLowerCase()
    || destinationRail !== String(quote.destination_rail ?? '').toLowerCase()
  ) {
    throw new ApiError(409, 'virtual_account_route_mismatch', 'Virtual account settlement route does not match the quote route')
  }
  if (String(virtualAccount.destination_address ?? '') !== walletAddress) {
    throw new ApiError(409, 'virtual_account_wallet_mismatch', 'Virtual account must settle to the assigned Universa Solana wallet')
  }
  source.virtual_account_id = virtualAccount.id
  if (virtualAccount.provider_virtual_account_id) {
    source.provider_virtual_account_id = virtualAccount.provider_virtual_account_id
  }
}

function dashboardPaymentKind(value: unknown): 'onramp' | 'offramp' {
  const kind = String(value ?? 'onramp').trim().toLowerCase()
  if (kind !== 'onramp' && kind !== 'offramp') {
    throw new ApiError(400, 'invalid_request', 'kind must be onramp or offramp')
  }
  return kind
}

function dashboardCurrency(value: unknown, field: string): string {
  return requireString(value, field, {
    max: 12,
    pattern: /^[A-Za-z]{3,12}$/,
  }).toLowerCase()
}

function dashboardRail(value: unknown, field: string): string {
  return requireString(value, field, {
    max: 50,
    pattern: /^[A-Za-z0-9_-]+$/,
  }).toLowerCase()
}

function readDashboardTenantFeeBps(value: unknown, context: DashboardContext): number {
  const candidate = value ?? context.tenant.default_fee_bps ?? 0
  const parsed = typeof candidate === 'number'
    ? candidate
    : Number(String(candidate).trim())
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 300) {
    throw new ApiError(400, 'invalid_request', 'tenant_fee_bps must be an integer from 0 to 300')
  }
  return parsed
}

function optionalPaymentExternalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, 'external_id', {
    max: 120,
    pattern: /^[A-Za-z0-9_.:-]+$/,
  })
}

function dashboardTransferRoute(
  value: unknown,
  currencyFallback: string,
  railFallback: string,
): Record<string, unknown> {
  const input = objectValue(value)
  return {
    ...input,
    currency: dashboardCurrency(input.currency ?? currencyFallback, 'route.currency'),
    payment_rail: dashboardRail(input.payment_rail ?? railFallback, 'route.payment_rail'),
  }
}

function publicDashboardQuote(quote: Record<string, any>): Record<string, unknown> {
  return {
    id: quote.id,
    customer_id: quote.customer_id,
    kind: quote.kind,
    source: {
      currency: quote.source_currency,
      payment_rail: quote.source_rail,
      amount: String(quote.gross_amount),
    },
    destination: {
      currency: quote.destination_currency,
      payment_rail: quote.destination_rail,
      amount: String(quote.destination_amount),
    },
    fees: {
      provider: String(quote.provider_fee ?? 0),
      universa: String(quote.universa_fee ?? 0),
      tenant: String(quote.tenant_fee ?? 0),
      platform: String(quote.platform_fee ?? 0),
      network: String(quote.network_fee ?? 0),
      currency: quote.fee_currency,
    },
    fee_bps: {
      provider: Number(quote.provider_fee_bps ?? 0),
      universa: Number(quote.universa_fee_bps ?? 0),
      tenant: Number(quote.tenant_fee_bps ?? 0),
      platform: Number(quote.universa_fee_bps ?? 0) + Number(quote.tenant_fee_bps ?? 0),
    },
    status: quote.status,
    expires_at: quote.expires_at,
    created_at: quote.created_at,
  }
}

function publicDashboardTransfer(transfer: Record<string, any>): Record<string, unknown> {
  const providerPayload = objectValue(transfer.provider_payload)
  return {
    id: transfer.id,
    customer_id: transfer.customer_id,
    quote_id: transfer.quote_id,
    provider: transfer.provider,
    provider_transfer_id: transfer.provider_transfer_id,
    kind: transfer.kind,
    status: transfer.status,
    execution_status: firstNonEmptyString(providerPayload.execution_status),
    settlement: {
      status: transfer.settlement_status ?? 'unsettled',
      batch_id: transfer.settlement_batch_id ?? null,
      item_id: transfer.settlement_item_id ?? null,
      settled_amount: String(transfer.settled_amount ?? 0),
      reserve_amount: String(transfer.settlement_reserved_amount ?? 0),
      settled_at: transfer.settled_at ?? null,
      details: transfer.settlement_details ?? {},
    },
    source: transfer.source,
    destination: transfer.destination,
    gross_amount: String(transfer.gross_amount),
    destination_amount: String(transfer.destination_amount),
    fees: {
      provider: String(transfer.provider_fee ?? 0),
      universa: String(transfer.universa_fee ?? 0),
      tenant: String(transfer.tenant_fee ?? 0),
      platform: String(transfer.platform_fee ?? 0),
      network: String(transfer.network_fee ?? 0),
      currency: transfer.currency,
    },
    created_at: transfer.created_at,
    updated_at: transfer.updated_at,
  }
}

async function recordDashboardStateEvent(
  admin: any,
  context: DashboardContext,
  resourceType: WebhookResourceType,
  resourceId: string,
  previousStatus: string | null,
  nextStatus: string,
  requestId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const provider = typeof details.provider === 'string' ? details.provider : null
  const providerResourceId = firstNonEmptyString(
    details.provider_transfer_id,
    details.provider_customer_id,
    details.provider_session_id,
    details.provider_virtual_account_id,
  )
  const { error } = await admin.from('platform_state_events').insert({
    tenant_id: context.tenant.id,
    resource_type: resourceType,
    resource_id: resourceId,
    previous_status: previousStatus,
    next_status: nextStatus,
    source: 'dashboard',
    provider,
    provider_resource_id: providerResourceId,
    request_id: requestId,
    idempotency_key: null,
    details,
  })
  if (error) {
    if (error.code !== '42P01') {
      console.error('[dashboard-api] state event failed', {
        resourceType,
        resourceId,
        requestId,
        error,
      })
    }
    return
  }

  await enqueueDashboardWebhookEvent(
    admin,
    context,
    resourceType,
    resourceId,
    previousStatus,
    nextStatus,
    requestId,
    provider,
    providerResourceId,
    details,
  )
}

async function enqueueDashboardWebhookEvent(
  admin: any,
  context: DashboardContext,
  resourceType: WebhookResourceType,
  resourceId: string,
  previousStatus: string | null,
  nextStatus: string,
  requestId: string,
  provider: string | null,
  providerResourceId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  const eventType = webhookEventType(resourceType, previousStatus)
  const endpoints = await listActiveWebhookEndpoints(admin, context.tenant.id)
  const matchingEndpoints = endpoints.filter((endpoint: Record<string, unknown>) =>
    matchesWebhookSubscription(endpoint.subscribed_events, eventType)
  )
  if (!matchingEndpoints.length) return

  const eventId = randomId('evt')
  const createdAt = new Date().toISOString()
  const payload = webhookEventPayload({
    id: eventId,
    type: eventType,
    createdAt,
    livemode: context.tenant.environment === 'production',
    tenantId: context.tenant.id,
    object: {
      resource_type: resourceType,
      resource_id: resourceId,
      previous_status: previousStatus,
      status: nextStatus,
      source: 'dashboard',
      provider,
      provider_resource_id: providerResourceId,
      request_id: requestId,
      idempotency_key: null,
      details,
    },
  })
  const { error } = await admin.from('webhook_outbox').insert(
    matchingEndpoints.map((endpoint: Record<string, unknown>) => ({
      id: randomId('wo'),
      tenant_id: context.tenant.id,
      endpoint_id: endpoint.id,
      event_type: eventType,
      resource_id: resourceId,
      payload,
      status: 'pending',
      attempts: 0,
      next_attempt_at: createdAt,
    })),
  )
  if (error && error.code !== '42P01') {
    console.error('[dashboard-api] webhook enqueue failed', {
      resourceType,
      resourceId,
      eventType,
      requestId,
      error,
    })
  }
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
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

async function listDashboardCustomers(admin: any, tenantId: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await admin
    .from('platform_customers')
    .select('id,external_id,type,full_name,email,country_code,status,provider,provider_customer_id,provider_kyc_status,metadata,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []).filter((row: Record<string, any>) => !isDashboardHiddenResource(row))
}

async function listDashboardVirtualAccounts(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, any>>> {
  const { data, error } = await admin
    .from('virtual_accounts')
    .select('id,customer_id,provider,provider_virtual_account_id,source_currency,source_rail,destination_currency,destination_rail,destination_address,status,deposit_instructions,provider_status_raw,last_provider_sync_at,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

function mergeDashboardCustomersFromVirtualAccounts(
  customers: Array<Record<string, any>>,
  virtualAccounts: Array<Record<string, any>>,
): Array<Record<string, any>> {
  const merged = [...customers]
  const customerIds = new Set(customers.map((customer) => String(customer.id)))

  for (const account of virtualAccounts) {
    const customerId = String(account.customer_id ?? '').trim()
    if (!customerId || customerIds.has(customerId)) continue
    customerIds.add(customerId)
    merged.push(importedCustomerFromVirtualAccount(account, customerId))
  }

  return merged.sort((left, right) =>
    String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''))
  )
}

function importedCustomerFromVirtualAccount(
  account: Record<string, any>,
  customerId: string,
): Record<string, any> {
  const deposit = objectValue(account.deposit_instructions)
  const accountHolder = firstNonEmptyString(
    deposit.account_holder_name,
    deposit.account_name,
    deposit.bank_account_holder_name,
    deposit.bank_beneficiary_name,
    deposit.beneficiary_name,
    deposit.recipient_name,
    deposit.beneficiary,
  )
  const email = firstNonEmptyString(
    deposit.email,
    objectValue(deposit.beneficiary).email,
    objectValue(deposit.account).email,
  )
  const status = isActiveVirtualAccountStatus(account.status) ? 'active' : String(account.status ?? 'created')

  return {
    id: customerId,
    external_id: customerId,
    type: 'individual',
    full_name: accountHolder ?? 'Imported provider customer',
    email,
    country_code: countryCodeFromVirtualAccount(account, deposit),
    status,
    provider: account.provider,
    provider_customer_id: customerId,
    provider_kyc_status: status === 'active' ? 'approved' : status,
    metadata: {
      source: 'virtual_account_import',
      imported_from_virtual_account_id: account.id,
      provider_virtual_account_id: account.provider_virtual_account_id ?? null,
    },
    created_at: account.created_at,
    updated_at: account.updated_at,
  }
}

function isActiveVirtualAccountStatus(status: unknown): boolean {
  return ['active', 'activated', 'approved', 'issued', 'open', 'pending']
    .includes(String(status ?? '').toLowerCase())
}

function countryCodeFromVirtualAccount(
  account: Record<string, any>,
  deposit: Record<string, any>,
): string {
  const explicit = firstNonEmptyString(
    deposit.country,
    deposit.country_code,
    deposit.bank_country,
    deposit.bank_country_code,
  )
  const normalized = normalizeCountryCode(explicit)
  if (normalized) return normalized

  const currency = String(account.source_currency ?? deposit.currency ?? '').toLowerCase()
  if (currency === 'usd') return 'US'
  if (currency === 'mxn') return 'MX'
  if (currency === 'brl') return 'BR'
  if (currency === 'cop') return 'CO'
  if (currency === 'gbp') return 'GB'
  return ''
}

function normalizeCountryCode(value: string | null): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const aliases: Record<string, string> = {
    us: 'US',
    usa: 'US',
    'united states': 'US',
    mx: 'MX',
    mex: 'MX',
    mexico: 'MX',
    br: 'BR',
    bra: 'BR',
    brazil: 'BR',
    co: 'CO',
    col: 'CO',
    colombia: 'CO',
    gb: 'GB',
    gbr: 'GB',
    uk: 'GB',
    'united kingdom': 'GB',
  }
  if (aliases[raw]) return aliases[raw]
  return /^[a-z]{2}$/.test(raw) ? raw.toUpperCase() : ''
}

function isDashboardHiddenResource(row: Record<string, any>): boolean {
  const source = String(objectValue(row.metadata).source ?? '').trim().toLowerCase()
  return source === 'smoke-test' || source === 'negative-smoke'
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

async function listRecentTransfers(
  admin: any,
  tenantId: string,
  customerIds: string[] = [],
): Promise<Array<Record<string, any>>> {
  if (!customerIds.length) return []
  const { data, error } = await admin
    .from('transfers')
    .select('id,customer_id,provider,provider_transfer_id,kind,status,reconciliation_status,settlement_status,settlement_batch_id,settlement_item_id,settled_amount,settlement_reserved_amount,settled_at,settlement_details,source,destination,gross_amount,destination_amount,provider_fee,platform_fee,universa_fee,tenant_fee,network_fee,currency,provider_payload,provider_status_raw,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .in('customer_id', customerIds)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return data ?? []
}

async function listSettlementObligations(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, any>>> {
  const { data, error } = await admin
    .from('provider_settlement_obligations')
    .select('transfer_id,tenant_id,customer_id,customer_external_id,customer_email,provider,provider_transfer_id,kind,transfer_status,reconciliation_status,settlement_status,gross_amount,provider_fee,universa_fee,tenant_fee,platform_fee,network_fee,currency,settled_amount,settlement_reserved_amount,amount_outstanding,created_at,updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (error) throw error
  return data ?? []
}

async function listRecentSettlementBatches(
  admin: any,
  tenantId: string,
): Promise<Array<Record<string, any>>> {
  const { data: items, error: itemError } = await admin
    .from('provider_settlement_items')
    .select('batch_id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (itemError) throw itemError
  const batchIds = [...new Set((items ?? []).map((item: Record<string, any>) => String(item.batch_id)))]
    .filter(Boolean)
    .slice(0, 20)
  if (!batchIds.length) return []

  const { data, error } = await admin
    .from('provider_settlement_batch_summary')
    .select('id,provider,provider_settlement_id,status,currency,amount_expected,amount_received,allocated_amount,reserve_amount,item_count,settled_item_count,partially_settled_item_count,held_item_count,item_amount_received,item_reserve_amount,settlement_period_start,settlement_period_end,received_at,settled_at,created_at,updated_at')
    .in('id', batchIds)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data ?? []
}

function summarizeMetrics(
  customerCount: number,
  activeCustomerCount: number,
  virtualAccountCount: number,
  webhookCount: number,
  transfers: Array<Record<string, any>>,
  settlementObligations: Array<Record<string, any>> = [],
): Record<string, unknown> {
  const volumeByCurrency: Record<string, number> = {}
  const settlementOutstandingByCurrency: Record<string, number> = {}
  let tenantFees = 0
  let platformFees = 0
  let settlementOutstanding = 0
  const reconciliation: Record<string, number> = {
    unreconciled: 0,
    matched: 0,
    mismatch: 0,
    orphaned: 0,
    ignored: 0,
  }
  for (const transfer of transfers) {
    const status = String(transfer.status ?? '').toLowerCase()
    if (!isInactiveTransferStatus(status)) {
      const currency = String(transfer.currency ?? 'usd').toLowerCase()
      volumeByCurrency[currency] = (volumeByCurrency[currency] ?? 0) + Number(transfer.gross_amount ?? 0)
      tenantFees += Number(transfer.tenant_fee ?? 0)
      platformFees += Number(transfer.platform_fee ?? 0)
    }
    const reconStatus = String(transfer.reconciliation_status ?? 'unreconciled')
    reconciliation[reconStatus] = (reconciliation[reconStatus] ?? 0) + 1
  }
  for (const obligation of settlementObligations) {
    const amount = Number(obligation.amount_outstanding ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const currency = String(obligation.currency ?? 'usd').toLowerCase()
    settlementOutstanding += amount
    settlementOutstandingByCurrency[currency] = (settlementOutstandingByCurrency[currency] ?? 0) + amount
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
    settlement_outstanding: settlementOutstanding,
    settlement_outstanding_by_currency: settlementOutstandingByCurrency,
    settlement_obligations: settlementObligations.length,
    reconciliation,
  }
}

function isInactiveTransferStatus(status: string): boolean {
  return ['canceled', 'cancelled', 'failed', 'rejected', 'returned'].includes(status)
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
  const metadata = objectValue(context.tenant.metadata)
  const countryCode = firstStringMetadata(metadata, [
    'country_code',
    'account_country_code',
    'business_country_code',
    'country',
    'business_country',
    'default_country',
  ])
  const displayCurrency = firstStringMetadata(metadata, [
    'display_currency',
    'account_currency',
    'default_currency',
    'currency',
  ]) || currencyForCountry(countryCode)
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
    country_code: countryCode || null,
    display_currency: displayCurrency || 'USD',
    default_fee_bps: context.tenant.default_fee_bps ?? 0,
  }
}

function firstStringMetadata(metadata: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = String(metadata[key] ?? '').trim()
    if (value) return value
  }
  return ''
}

function currencyForCountry(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase()
  return ({
    US: 'USD',
    MX: 'MXN',
    BR: 'BRL',
    CO: 'COP',
    GB: 'GBP',
  } as Record<string, string>)[normalized] ?? 'USD'
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
