import { authenticateRequest, requireScope } from './auth.ts'
import { decryptSecret, encryptSecret, hmacSha256Hex, randomId, sha256Hex, timingSafeEqualHex } from './crypto.ts'
import { ApiError, requireObject, requireString } from './errors.ts'
import { dashboardQuoteDestinationAmount } from './dashboard_pricing.ts'
import { clientIp, jsonResponse, normalizedApiPath, parseJson } from './http.ts'
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from './idempotency.ts'
import { calculatePricing, quoteExpiry } from './pricing.ts'
import { createPrivySolanaWallet, exportPrivySolanaWallet } from './privy.ts'
import { providerForRequest, providerIdempotencyKey } from './provider.ts'
import type { PlatformCustomer, RequestContext } from './types.ts'
import {
  DEFAULT_WEBHOOK_SUBSCRIPTIONS,
  matchesWebhookSubscription,
  normalizeWebhookSubscriptions,
  signWebhookPayload,
  webhookEventType,
  webhookRetryDelaySeconds,
} from './webhooks.ts'

const ORIGINAL_ENV = new Map<string, string | undefined>()

for (const name of [
  'API_KEYS_MASTER_SECRET',
  'BOOTSTRAP_API_SECRET',
  'DEFAULT_TENANT_FEE_BPS',
  'ESTIMATED_NETWORK_FEE',
  'ESTIMATED_PROVIDER_FEE_BPS',
  'MAX_TENANT_FEE_BPS',
  'MOCK_AUTO_APPROVE_KYC',
  'PARTNER_API_KEY',
  'PARTNER_API_URL',
  'PARTNER_REDIRECT_URI',
  'PLATFORM_PROVIDER',
  'PRIVY_API_URL',
  'PRIVY_AUTH_PRIV_KEY',
  'PRIVY_AUTH_PUB_KEY',
  'PRIVY_SOL_APP_ID',
  'PRIVY_SOL_APP_SECRET',
  'PRIVY_WALLET_MODE',
  'QUOTE_TTL_SECONDS',
  'UNIVERSA_FEE_BPS',
]) {
  ORIGINAL_ENV.set(name, Deno.env.get(name))
}

Deno.test('crypto helpers hash, sign, compare, encrypt, decrypt, and generate ids', async () => {
  withEnv({ API_KEYS_MASTER_SECRET: 'unit-test-master-secret' })

  assertEquals(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assertEquals(
    await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  )
  assert(timingSafeEqualHex('ABCDEF', 'abcdef'))
  assert(!timingSafeEqualHex('abc', 'abcd'))
  assert(!timingSafeEqualHex('abc', 'xyz'))
  assert(!timingSafeEqualHex('not-hex', 'not-hex'))

  const encrypted = await encryptSecret('super-secret')
  assert(encrypted.startsWith('v1.'))
  assertEquals(await decryptSecret(encrypted), 'super-secret')

  Deno.env.set('BOOTSTRAP_API_SECRET', 'env-secret')
  assertEquals(await decryptSecret('env:BOOTSTRAP_API_SECRET'), 'env-secret')
  assertMatch(randomId('cus'), /^cus_[A-Za-z0-9_-]{22}$/)
})

Deno.test('http helpers normalize paths, parse bodies, and expose CORS JSON responses', async () => {
  assertEquals(
    normalizedApiPath(new URL('https://example.test/functions/v1/platform-api/v1/transfers?limit=10')),
    '/v1/transfers?limit=10',
  )
  assertEquals(
    normalizedApiPath(new URL('https://example.test/platform-api/v1/customers')),
    '/v1/customers',
  )
  assertEquals(parseJson('{"ok":true}'), { ok: true })
  assertEquals(parseJson(''), {})

  const invalidJson = assertThrowsApiError(() => parseJson('{bad'))
  assertEquals(invalidJson.status, 400)
  assertEquals(invalidJson.code, 'invalid_json')

  const invalidShape = assertThrowsApiError(() => parseJson('[]'))
  assertEquals(invalidShape.status, 400)
  assertEquals(invalidShape.code, 'invalid_json')

  const response = jsonResponse({ ok: true }, 202, { 'X-Test': 'yes' })
  assertEquals(response.status, 202)
  assertEquals(response.headers.get('content-type'), 'application/json')
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  assertEquals(response.headers.get('x-test'), 'yes')
  assertEquals(await response.json(), { ok: true })

  assertEquals(
    clientIp(new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    })),
    '203.0.113.10',
  )
})

Deno.test('request validation trims strings and rejects missing, oversized, malformed, or non-object values', () => {
  assertEquals(requireString('  ALICE@example.com  ', 'email'), 'ALICE@example.com')
  assertEquals(requireString('abc', 'value', { max: 3 }), 'abc')
  assertEquals(requireString('US', 'country', { pattern: /^[A-Z]{2}$/ }), 'US')

  assertEquals(assertThrowsApiError(() => requireString('', 'name')).code, 'invalid_request')
  assertEquals(assertThrowsApiError(() => requireString('abcd', 'value', { max: 3 })).code, 'invalid_request')
  assertEquals(assertThrowsApiError(() => requireString('usa', 'country', { pattern: /^[A-Z]{2}$/ })).code, 'invalid_request')
  assertEquals(requireObject({ ok: true }, 'metadata'), { ok: true })
  assertEquals(assertThrowsApiError(() => requireObject([], 'metadata')).code, 'invalid_request')
})

Deno.test('pricing rounds fees up by basis point and rejects unsafe amount shapes', () => {
  withEnv({
    DEFAULT_TENANT_FEE_BPS: '0',
    ESTIMATED_NETWORK_FEE: '0.00',
    ESTIMATED_PROVIDER_FEE_BPS: '75',
    UNIVERSA_FEE_BPS: '30',
  })

  assertEquals(calculatePricing('100.00', 'USDC', 20), {
    grossAmount: '100.00',
    providerFee: '0.75',
    universaFee: '0.30',
    tenantFee: '0.20',
    platformFee: '0.50',
    networkFee: '0.00',
    destinationAmount: '98.75',
    feeCurrency: 'usdc',
    pricingVersion: 'v1:partner-75:universa-30:tenant-20',
    universaFeeBps: 30,
    tenantFeeBps: 20,
    providerFeeBps: 75,
  })

  const roundedSmallAmount = calculatePricing('0.04', 'USD', 1)
  assertEquals(roundedSmallAmount.providerFee, '0.01')
  assertEquals(roundedSmallAmount.universaFee, '0.01')
  assertEquals(roundedSmallAmount.tenantFee, '0.01')
  assertEquals(roundedSmallAmount.destinationAmount, '0.01')

  assertEquals(assertThrowsApiError(() => calculatePricing('0', 'usd')).code, 'invalid_amount')
  assertEquals(assertThrowsApiError(() => calculatePricing('1.001', 'usd')).code, 'invalid_amount')
  assertEquals(assertThrowsApiError(() => calculatePricing('abc', 'usd')).code, 'invalid_amount')
  assertEquals(assertThrowsApiError(() => calculatePricing('0.01', 'usd', 10_000)).code, 'amount_below_minimum')
})

Deno.test('dashboard quote pricing converts net source amount to destination corridor currency', () => {
  assertEquals(
    dashboardQuoteDestinationAmount('987.50', 'usdc', 'mxn', 'spei'),
    {
      amount: '16985.00',
      rate: '17.2',
      pricingVersionSuffix: ':fx-usdc-mxn-17.2',
    },
  )
  assertEquals(
    dashboardQuoteDestinationAmount('987.50', 'usdc', 'cop', 'bank'),
    {
      amount: '3875938',
      rate: '3925',
      pricingVersionSuffix: ':fx-usdc-cop-3925',
    },
  )
})

Deno.test('webhook helpers normalize subscriptions, match events, sign payloads, and back off', async () => {
  assertEquals(webhookEventType('transfer', null), 'transfer.created')
  assertEquals(webhookEventType('transfer', 'awaiting_funds'), 'transfer.status_changed')
  assertEquals(normalizeWebhookSubscriptions(undefined), DEFAULT_WEBHOOK_SUBSCRIPTIONS)
  assertEquals(normalizeWebhookSubscriptions(['transfer.*', 'transfer.created', 'transfer.*']), [
    'transfer.*',
    'transfer.created',
  ])
  assert(matchesWebhookSubscription(['transfer.*'], 'transfer.status_changed'))
  assert(matchesWebhookSubscription(['*'], 'customer.created'))
  assert(!matchesWebhookSubscription(['quote.*'], 'transfer.created'))
  assertEquals(webhookRetryDelaySeconds(0), 30)
  assertEquals(webhookRetryDelaySeconds(3), 240)
  assertEquals(webhookRetryDelaySeconds(20), 3600)
  assertEquals(
    await signWebhookPayload('whsec_test', '1718232000', '{"id":"evt_test"}'),
    await hmacSha256Hex('whsec_test', '1718232000.{"id":"evt_test"}'),
  )

  assertEquals(assertThrowsApiError(() => normalizeWebhookSubscriptions(['bad.event'])).code, 'invalid_webhook_event')
})

Deno.test('quote expiry clamps TTL to 30..3600 seconds', () => {
  withEnv({ QUOTE_TTL_SECONDS: '1' })
  const shortTtlMs = new Date(quoteExpiry()).getTime() - Date.now()
  assert(shortTtlMs >= 29_000 && shortTtlMs <= 31_000)

  withEnv({ QUOTE_TTL_SECONDS: '7200' })
  const longTtlMs = new Date(quoteExpiry()).getTime() - Date.now()
  assert(longTtlMs >= 3_599_000 && longTtlMs <= 3_601_000)
})

Deno.test('provider selection enforces tenant config and emits deterministic mock outputs', async () => {
  const context = baseContext({ idempotencyKey: 'provider-idem' })
  withEnv({ PLATFORM_PROVIDER: 'mock', MOCK_AUTO_APPROVE_KYC: 'true' })

  const provider = await providerForRequest(
    mockAdmin({
      tenant_provider_configs: [{
        tenant_id: 'ten_test',
        provider: 'mock',
        status: 'sandbox',
        approval_status: 'pending',
      }],
    }),
    context,
  )
  assertEquals(provider.name, 'mock')
  assertEquals(providerIdempotencyKey(context, 'kyc'), 'kyc:ten_test:provider-idem')

  const customer: PlatformCustomer = {
    id: 'cus_test',
    external_id: 'ext',
    tenant_id: 'ten_test',
    type: 'individual',
    full_name: 'Universa Test',
    email: 'test@example.com',
    country_code: 'US',
    status: 'created',
    provider: 'mock',
    provider_customer_id: null,
    provider_kyc_status: null,
    provider_status_raw: null,
    last_provider_sync_at: null,
    kyc_started_at: null,
    kyc_active_at: null,
    kyc_rejected_at: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const kyc = await provider.createKycSession(customer, 'same-idem')
  assertEquals(kyc.status, 'active')
  assert(kyc.providerCustomerId.startsWith('mock_cus_'))

  const account = await provider.createVirtualAccount(
    customer,
    {
      sourceCurrency: 'usd',
      destinationCurrency: 'usdc',
      destinationRail: 'base',
      destinationAddress: '0x1',
      platformFeePercent: '0.3',
    },
    'va-idem',
  )
  assertEquals(account.status, 'active')
  assertEquals(account.sourceRail, 'ach')
  assertEquals(account.depositInstructions.currency, 'usd')

  const transfer = await provider.createTransfer(
    customer,
    {
      amount: '100.00',
      platformFee: '0.30',
      clientReferenceId: 'ten_test:tr_test',
      source: { currency: 'usdc', payment_rail: 'base' },
      destination: { currency: 'usd', payment_rail: 'ach' },
    },
    'tr-idem',
  )
  assertEquals(transfer.status, 'awaiting_funds')
  assertEquals(transfer.sourceDepositInstructions?.currency, 'usdc')

  const disabled = await assertRejectsApiError(() =>
    providerForRequest(mockAdmin({ tenant_provider_configs: [] }), context)
  )
  assertEquals(disabled.status, 403)
  assertEquals(disabled.code, 'provider_not_enabled')

  withEnv({ PLATFORM_PROVIDER: 'partner' })
  const notApproved = await assertRejectsApiError(() =>
    providerForRequest(
      mockAdmin({
        tenant_provider_configs: [{
          tenant_id: 'ten_test',
          provider: 'partner',
          status: 'sandbox',
          approval_status: 'pending',
        }],
      }),
      context,
    )
  )
  assertEquals(notApproved.status, 403)
  assertEquals(notApproved.code, 'provider_approval_required')
})

Deno.test('Privy wallet helper supports mock Solana provisioning and HPKE export shape', async () => {
  withEnv({
    PLATFORM_PROVIDER: 'mock',
    PRIVY_WALLET_MODE: 'mock',
    PRIVY_SOL_APP_ID: undefined,
    PRIVY_SOL_APP_SECRET: undefined,
    PRIVY_AUTH_PUB_KEY: undefined,
    PRIVY_AUTH_PRIV_KEY: undefined,
  })

  const wallet = await createPrivySolanaWallet({ customer_id: 'cus_test' })
  assertEquals(wallet.mock, true)
  assertEquals(wallet.appId, 'mock_privy_sol')
  assert(wallet.id.startsWith('privy_wallet_'))
  assertMatch(wallet.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/)

  const walletExport = await exportPrivySolanaWallet(wallet.id, 'hpke_recipient_public_key')
  assert(walletExport.encapsulated_key?.startsWith('mock_enc_'))
  assert(walletExport.ciphertext?.startsWith('mock_cipher_'))
  assertEquals(walletExport.raw.mock, true)
})

Deno.test('idempotency handles required keys, replay, conflicts, in-progress, failed retry, and completion', async () => {
  const context = baseContext({ idempotencyKey: 'idem-1', method: 'POST', path: '/v1/transfers', rawBody: '{"a":1}' })
  const requestHash = await sha256Hex('POST\n/v1/transfers\n{"a":1}')

  const missingKey = await assertRejectsApiError(() =>
    beginIdempotentRequest(mockAdmin(), baseContext({ idempotencyKey: null }))
  )
  assertEquals(missingKey.status, 400)
  assertEquals(missingKey.code, 'idempotency_required')

  const freshAdmin = mockAdmin()
  const fresh = await beginIdempotentRequest(freshAdmin, context)
  assertEquals(fresh.replay, false)
  if (!fresh.replay) assert(fresh.rowId.startsWith('api_idempotency_keys_'))

  const replay = await beginIdempotentRequest(
    mockAdmin({
      api_idempotency_keys: [{
        id: 'idem_row',
        api_key_id: 'key_test',
        idempotency_key: 'idem-1',
        request_hash: requestHash,
        status: 'completed',
        response_status: 201,
        response_body: { transfer: { id: 'tr_1' } },
        updated_at: new Date().toISOString(),
      }],
    }),
    context,
  )
  assertEquals(replay, { replay: true, status: 201, body: { transfer: { id: 'tr_1' } } })

  const conflict = await assertRejectsApiError(() =>
    beginIdempotentRequest(
      mockAdmin({
        api_idempotency_keys: [{
          id: 'idem_row',
          api_key_id: 'key_test',
          idempotency_key: 'idem-1',
          request_hash: 'different',
          status: 'completed',
          response_status: 201,
          response_body: { ok: true },
          updated_at: new Date().toISOString(),
        }],
      }),
      context,
    )
  )
  assertEquals(conflict.status, 409)
  assertEquals(conflict.code, 'idempotency_conflict')

  const inProgress = await assertRejectsApiError(() =>
    beginIdempotentRequest(
      mockAdmin({
        api_idempotency_keys: [{
          id: 'idem_row',
          api_key_id: 'key_test',
          idempotency_key: 'idem-1',
          request_hash: requestHash,
          status: 'processing',
          response_status: null,
          response_body: null,
          updated_at: new Date().toISOString(),
        }],
      }),
      context,
    )
  )
  assertEquals(inProgress.status, 409)
  assertEquals(inProgress.code, 'idempotency_in_progress')

  const retry = await beginIdempotentRequest(
    mockAdmin({
      api_idempotency_keys: [{
        id: 'idem_row',
        api_key_id: 'key_test',
        idempotency_key: 'idem-1',
        request_hash: requestHash,
        status: 'failed',
        response_status: null,
        response_body: null,
        updated_at: new Date().toISOString(),
      }],
    }),
    context,
  )
  assertEquals(retry, { replay: false, rowId: 'idem_row' })

  const completeAdmin = mockAdmin({
    api_idempotency_keys: [{
      id: 'idem_row',
      api_key_id: 'key_test',
      idempotency_key: 'idem-1',
      request_hash: requestHash,
      status: 'processing',
      response_status: null,
      response_body: null,
      updated_at: new Date().toISOString(),
    }],
  })
  await completeIdempotentRequest(completeAdmin, 'idem_row', 201, { ok: true }, 'tr_1')
  assertEquals(completeAdmin.tables.api_idempotency_keys[0].status, 'completed')
  assertEquals(completeAdmin.tables.api_idempotency_keys[0].operation_ref, 'tr_1')
  await failIdempotentRequest(completeAdmin, 'idem_row', 'provider_failed')
  assertEquals(completeAdmin.tables.api_idempotency_keys[0].status, 'failed')
  assertEquals(completeAdmin.tables.api_idempotency_keys[0].error_code, 'provider_failed')
})

Deno.test('authentication verifies HMAC, scopes, nonce replay, tenant gates, timestamp skew, and IP allowlist', async () => {
  withEnv({ BOOTSTRAP_API_SECRET: 'auth-secret' })
  const path = '/v1/transfers'
  const rawBody = '{"quote_id":"quo_1"}'
  const signed = await signedRequest({
    apiKey: 'mk_test_local',
    secret: 'auth-secret',
    method: 'POST',
    path,
    rawBody,
    nonce: 'nonce-1',
  })
  const admin = authAdmin()
  const context = await authenticateRequest(admin, signed, {
    requestId: 'req_1',
    method: 'POST',
    path,
    rawBody,
    ip: '203.0.113.8',
    userAgent: 'unit-test',
  })
  assertEquals(context.tenant.id, 'ten_test')
  assertEquals(context.apiKey.id, 'key_test')
  assertEquals(context.idempotencyKey, 'transfer-1')
  assertEquals(admin.tables.api_nonces.length, 1)
  assertEquals(admin.tables.tenant_api_keys[0].last_used_at !== undefined, true)
  requireScope(context, 'transfers:write')

  const missingScope = assertThrowsApiError(() => requireScope(context, 'quotes:write'))
  assertEquals(missingScope.status, 403)
  assertEquals(missingScope.code, 'scope_not_allowed')

  const badSignature = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin(), signed, {
      requestId: 'req_2',
      method: 'POST',
      path,
      rawBody: '{"quote_id":"tampered"}',
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(badSignature.status, 401)
  assertEquals(badSignature.code, 'bad_signature')

  const replay = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin({ nonceConflict: true }), signed, {
      requestId: 'req_3',
      method: 'POST',
      path,
      rawBody,
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(replay.status, 401)
  assertEquals(replay.code, 'replayed_nonce')

  const expiredTimestamp = await signedRequest({
    apiKey: 'mk_test_local',
    secret: 'auth-secret',
    method: 'POST',
    path,
    rawBody,
    timestamp: Date.now() - 6 * 60 * 1000,
  })
  const timestampError = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin(), expiredTimestamp, {
      requestId: 'req_4',
      method: 'POST',
      path,
      rawBody,
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(timestampError.status, 401)
  assertEquals(timestampError.code, 'invalid_timestamp')

  const suspendedTenant = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin({ tenantPatch: { status: 'suspended' } }), signed, {
      requestId: 'req_5',
      method: 'POST',
      path,
      rawBody,
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(suspendedTenant.status, 403)
  assertEquals(suspendedTenant.code, 'tenant_unavailable')

  const productionKyb = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin({ tenantPatch: { environment: 'production', kyb_status: 'pending' } }), signed, {
      requestId: 'req_6',
      method: 'POST',
      path,
      rawBody,
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(productionKyb.status, 403)
  assertEquals(productionKyb.code, 'tenant_kyb_required')

  const blockedIp = await assertRejectsApiError(() =>
    authenticateRequest(authAdmin({ apiKeyPatch: { ip_allowlist: ['198.51.100.1'] } }), signed, {
      requestId: 'req_7',
      method: 'POST',
      path,
      rawBody,
      ip: '203.0.113.8',
      userAgent: 'unit-test',
    })
  )
  assertEquals(blockedIp.status, 403)
  assertEquals(blockedIp.code, 'ip_not_allowed')
})

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req_test',
    tenant: {
      id: 'ten_test',
      name: 'Test Tenant',
      status: 'active',
      environment: 'sandbox',
      kyb_status: 'approved',
      risk_tier: 'standard',
    },
    apiKey: {
      id: 'key_test',
      tenant_id: 'ten_test',
      key_hash: 'hash',
      secret_ciphertext: 'env:BOOTSTRAP_API_SECRET',
      status: 'active',
      scopes: [
        'customers:read',
        'customers:write',
        'customer_wallets:read',
        'customer_wallets:export',
        'kyc:write',
        'quotes:write',
        'transfers:read',
        'transfers:write',
        'virtual_accounts:read',
        'virtual_accounts:write',
      ],
      ip_allowlist: [],
      expires_at: null,
      tenants: {
        id: 'ten_test',
        name: 'Test Tenant',
        status: 'active',
        environment: 'sandbox',
        kyb_status: 'approved',
        risk_tier: 'standard',
      },
    },
    method: 'POST',
    path: '/v1/transfers',
    rawBody: '{}',
    idempotencyKey: 'idem_test',
    ip: '127.0.0.1',
    userAgent: 'unit-test',
    ...overrides,
  } as RequestContext
}

function authAdmin(options: {
  apiKeyPatch?: Record<string, unknown>
  nonceConflict?: boolean
  tenantPatch?: Record<string, unknown>
} = {}) {
  const tenant = {
    id: 'ten_test',
    name: 'Test Tenant',
    status: 'active',
    environment: 'sandbox',
    kyb_status: 'approved',
    risk_tier: 'standard',
    ...options.tenantPatch,
  }
  return mockAdmin({
    tenant_api_keys: [{
      id: 'key_test',
      tenant_id: 'ten_test',
      key_hash: '1f4c716c555548a862c9dd89420833839a0d7540e9664aafa99484727aaebbbc',
      secret_ciphertext: 'env:BOOTSTRAP_API_SECRET',
      status: 'active',
      scopes: ['transfers:write'],
      ip_allowlist: [],
      expires_at: null,
      tenants: tenant,
      ...options.apiKeyPatch,
    }],
    api_nonces: options.nonceConflict
      ? [{ api_key_id: 'key_test', nonce: 'nonce-1', timestamp_ms: Date.now() }]
      : [],
  })
}

async function signedRequest(input: {
  apiKey: string
  secret: string
  method: string
  path: string
  rawBody: string
  nonce?: string
  timestamp?: number
}): Promise<Request> {
  const timestamp = String(input.timestamp ?? Date.now())
  const nonce = input.nonce ?? 'nonce-test'
  const bodyHash = await sha256Hex(input.rawBody)
  const canonical = [timestamp, nonce, input.method, input.path, bodyHash].join('\n')
  const signature = await hmacSha256Hex(input.secret, canonical)
  return new Request(`https://example.test${input.path}`, {
    method: input.method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'transfer-1',
      'x-universa-api-key': input.apiKey,
      'x-universa-nonce': nonce,
      'x-universa-signature': signature,
      'x-universa-timestamp': timestamp,
    },
    body: input.rawBody,
  })
}

function mockAdmin(initial: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    api_idempotency_keys: [],
    api_nonces: [],
    tenant_api_keys: [],
    tenant_provider_configs: [],
    ...structuredClone(initial),
  }
  return {
    tables,
    from(table: string) {
      return new Query(tables, table)
    },
  }
}

class Query {
  private filters: Array<{ column: string; operator: string; value: unknown }> = []
  private payload: unknown
  private selected = false
  private operation: 'select' | 'insert' | 'update' | null = null

  constructor(
    private readonly tables: Record<string, any[]>,
    private readonly table: string,
  ) {}

  select(_columns?: string) {
    this.selected = true
    if (!this.operation) this.operation = 'select'
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Record<string, unknown>) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: 'eq', value })
    return this
  }

  async maybeSingle() {
    try {
      const rows = await this.execute()
      return { data: rows[0] ?? null, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }

  async single() {
    try {
      const rows = await this.execute()
      if (!rows[0]) return { data: null, error: { code: 'PGRST116', message: 'No rows' } }
      return { data: rows[0], error: null }
    } catch (error) {
      return { data: null, error }
    }
  }

  then(resolve: (value: { data: any; error: any }) => void, reject: (reason?: unknown) => void) {
    this.execute()
      .then((rows) => resolve({ data: this.selected ? rows : null, error: null }))
      .catch((error) => resolve({ data: null, error }))
  }

  private async execute(): Promise<any[]> {
    const rows = this.tables[this.table] ??= []
    if (this.operation === 'insert') {
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = payloads.map((payload) => {
        const row: any = {
          id: `${this.table}_${rows.length + 1}`,
          ...payload as Record<string, unknown>,
        }
        if (
          this.table === 'api_nonces'
          && rows.some((existing) =>
            existing.api_key_id === row.api_key_id && existing.nonce === row.nonce
          )
        ) {
          throw { code: '23505', message: 'duplicate nonce' }
        }
        if (
          this.table === 'api_idempotency_keys'
          && rows.some((existing) =>
            existing.api_key_id === row.api_key_id
            && existing.idempotency_key === row.idempotency_key
          )
        ) {
          throw { code: '23505', message: 'duplicate idempotency key' }
        }
        rows.push(row)
        return row
      })
      return inserted
    }

    if (this.operation === 'update') {
      const matched = rows.filter((row) => this.matches(row))
      for (const row of matched) Object.assign(row, this.payload)
      return matched
    }

    return rows.filter((row) => this.matches(row))
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((filter) => {
      if (filter.operator === 'eq') return row[filter.column] === filter.value
      return true
    })
  }
}

function withEnv(values: Record<string, string | undefined>) {
  for (const [name, original] of ORIGINAL_ENV) {
    if (original === undefined) Deno.env.delete(name)
    else Deno.env.set(name, original)
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) Deno.env.delete(name)
    else Deno.env.set(name, value)
  }
}

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `expected ${expectedJson}, got ${actualJson}`)
  }
}

function assertMatch(value: string, pattern: RegExp) {
  if (!pattern.test(value)) throw new Error(`expected ${value} to match ${pattern}`)
}

function assertThrowsApiError(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected ApiError')
}

async function assertRejectsApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected ApiError')
}
