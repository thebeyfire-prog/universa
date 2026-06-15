import { createHash, createHmac, randomUUID } from 'node:crypto'

const endpoint =
  process.env.PLATFORM_API_URL
  ?? 'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api'
const apiKey = process.env.BOOTSTRAP_API_KEY ?? 'mk_test_local'
const apiSecret = process.env.BOOTSTRAP_API_SECRET

if (!apiSecret) {
  throw new Error('BOOTSTRAP_API_SECRET is required')
}

async function signedRequest(method, path, body, options = {}) {
  const rawBody = body === undefined ? '' : JSON.stringify(body)
  const timestamp = String(options.timestamp ?? Date.now())
  const nonce = options.nonce ?? randomUUID()
  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  const canonical = [timestamp, nonce, method, path, bodyHash].join('\n')
  const signature = createHmac('sha256', options.secret ?? apiSecret)
    .update(canonical)
    .digest('hex')
  const headers = {
    'content-type': 'application/json',
    'x-universa-api-key': options.apiKey ?? apiKey,
    'x-universa-timestamp': timestamp,
    'x-universa-nonce': nonce,
    'x-universa-signature': options.signature ?? signature,
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey

  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: rawBody || undefined,
  })
  return {
    response,
    payload: await response.json().catch(() => null),
    request: { method, path, rawBody, timestamp, nonce, headers },
  }
}

async function unsignedRequest(method, path) {
  const response = await fetch(`${endpoint}${path}`, { method })
  return {
    response,
    payload: await response.json().catch(() => null),
  }
}

function expectError(label, result, status, code) {
  const actualCode = result.payload?.error?.code
  if (result.response.status !== status || actualCode !== code) {
    throw new Error(
      `${label} expected ${status}/${code}, got ${result.response.status}/${actualCode}: ${
        JSON.stringify(result.payload)
      }`,
    )
  }
  console.log(label, status, code)
}

function expectOk(label, result, status) {
  if (result.response.status !== status) {
    throw new Error(
      `${label} expected ${status}, got ${result.response.status}: ${
        JSON.stringify(result.payload)
      }`,
    )
  }
  console.log(label, status)
}

const runId = Date.now()

expectError(
  'missing_auth',
  await unsignedRequest('GET', '/v1/transfers/nonexistent'),
  401,
  'missing_api_auth',
)

expectError(
  'stale_timestamp',
  await signedRequest(
    'POST',
    '/v1/customers',
    {
      external_id: `negative_stale_${runId}`,
      type: 'individual',
      full_name: 'Negative Smoke User',
      email: `negative-stale+${runId}@monet.money`,
      country_code: 'US',
    },
    {
      idempotencyKey: `negative-stale-${runId}`,
      timestamp: Date.now() - 6 * 60 * 1000,
    },
  ),
  401,
  'invalid_timestamp',
)

expectError(
  'bad_signature',
  await signedRequest(
    'POST',
    '/v1/customers',
    {
      external_id: `negative_bad_sig_${runId}`,
      type: 'individual',
      full_name: 'Negative Smoke User',
      email: `negative-bad-sig+${runId}@monet.money`,
      country_code: 'US',
    },
    {
      idempotencyKey: `negative-bad-sig-${runId}`,
      secret: 'wrong-secret',
    },
  ),
  401,
  'bad_signature',
)

const customerBody = {
  external_id: `negative_customer_${runId}`,
  type: 'individual',
  full_name: 'Negative Smoke User',
  email: `negative+${runId}@monet.money`,
  country_code: 'US',
  metadata: { source: 'negative-smoke' },
}
const customerKey = `negative-customer-${runId}`
const customerResult = await signedRequest('POST', '/v1/customers', customerBody, {
  idempotencyKey: customerKey,
})
expectOk('customer_seed', customerResult, 201)
const customerId = customerResult.payload.customer.id

expectError(
  'idempotency_conflict',
  await signedRequest(
    'POST',
    '/v1/customers',
    {
      ...customerBody,
      external_id: `negative_customer_changed_${runId}`,
      email: `negative-changed+${runId}@monet.money`,
    },
    { idempotencyKey: customerKey },
  ),
  409,
  'idempotency_conflict',
)

const nonce = randomUUID()
const timestamp = Date.now()
const nonceFirst = await signedRequest('GET', `/v1/customers/${customerId}`, undefined, {
  nonce,
  timestamp,
})
expectOk('nonce_seed', nonceFirst, 200)
expectError(
  'nonce_replay',
  await signedRequest('GET', `/v1/customers/${customerId}`, undefined, {
    nonce,
    timestamp,
  }),
  401,
  'replayed_nonce',
)

expectError(
  'not_found_after_auth',
  await signedRequest('GET', '/v1/transfers/tr_missing_negative_smoke'),
  404,
  'transfer_not_found',
)

console.log('negative_smoke_test', 'passed')
