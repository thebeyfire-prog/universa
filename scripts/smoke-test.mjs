import { createHash, createHmac, randomUUID } from 'node:crypto'

const endpoint =
  process.env.PLATFORM_API_URL
  ?? 'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api'
const apiKey = process.env.BOOTSTRAP_API_KEY ?? 'mk_test_local'
const apiSecret = process.env.BOOTSTRAP_API_SECRET

if (!apiSecret) {
  throw new Error('BOOTSTRAP_API_SECRET is required')
}

async function request(method, path, body, idempotencyKey) {
  const rawBody = body ? JSON.stringify(body) : ''
  const timestamp = String(Date.now())
  const nonce = randomUUID()
  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  const canonical = [timestamp, nonce, method, path, bodyHash].join('\n')
  const signature = createHmac('sha256', apiSecret).update(canonical).digest('hex')
  const headers = {
    'content-type': 'application/json',
    'x-universa-api-key': apiKey,
    'x-universa-timestamp': timestamp,
    'x-universa-nonce': nonce,
    'x-universa-signature': signature,
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey

  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: rawBody || undefined,
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`)
  }
  return { response, payload }
}

const runId = Date.now()
const customerResult = await request(
  'POST',
  '/v1/customers',
  {
    external_id: `smoke_${runId}`,
    type: 'individual',
    full_name: 'Universa Sandbox User',
    email: `sandbox+${runId}@monet.money`,
    country_code: 'US',
    metadata: { source: 'smoke-test' },
  },
  `customer-${runId}`,
)
const customer = customerResult.payload.customer
console.log('customer', customer.id, customer.status)

const kycResult = await request(
  'POST',
  `/v1/customers/${customer.id}/kyc-sessions`,
  {},
  `kyc-${runId}`,
)
console.log('kyc', kycResult.payload.kyc_session.id, kycResult.payload.customer.status)

const accountResult = await request(
  'POST',
  `/v1/customers/${customer.id}/virtual-accounts`,
  {
    source_currency: 'usd',
    destination: {
      currency: 'usdc',
      payment_rail: 'base',
      address: '0x0000000000000000000000000000000000000001',
    },
  },
  `virtual-account-${runId}`,
)
console.log(
  'virtual_account',
  accountResult.payload.virtual_account.id,
  accountResult.payload.virtual_account.status,
)

const quoteResult = await request(
  'POST',
  '/v1/quotes',
  {
    customer_id: customer.id,
    kind: 'offramp',
    amount: '100.00',
    source: { currency: 'usdc', payment_rail: 'base' },
    destination: { currency: 'usd', payment_rail: 'ach' },
    tenant_fee_bps: 20,
  },
  `quote-${runId}`,
)
const quote = quoteResult.payload.quote
console.log(
  'quote',
  quote.id,
  quote.destination.amount,
  quote.fees.universa,
  quote.fees.tenant,
  quote.fees.platform,
)

const transferBody = {
  quote_id: quote.id,
  external_id: `transfer_${runId}`,
  source: {
    currency: 'usdc',
    payment_rail: 'base',
    address: '0x0000000000000000000000000000000000000002',
  },
  destination: {
    currency: 'usd',
    payment_rail: 'ach',
    external_account_id: 'mock_external_account',
  },
}
const transferKey = `transfer-${runId}`
const transferResult = await request('POST', '/v1/transfers', transferBody, transferKey)
const transfer = transferResult.payload.transfer
console.log('transfer', transfer.id, transfer.status)

const fetchedResult = await request('GET', `/v1/transfers/${transfer.id}`)
console.log('transfer_get', fetchedResult.payload.transfer.id)

const replayResult = await request('POST', '/v1/transfers', transferBody, transferKey)
console.log(
  'idempotent_replay',
  replayResult.response.headers.get('x-idempotent-replay'),
  replayResult.payload.transfer.id,
)

if (replayResult.payload.transfer.id !== transfer.id) {
  throw new Error('Idempotent replay returned a different transfer')
}

console.log('smoke_test', 'passed')
