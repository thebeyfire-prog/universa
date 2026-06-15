import { createHash, createHmac, randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api'

export class UniversaApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'UniversaApiError'
    this.status = options.status ?? 0
    this.code = options.code ?? 'api_error'
    this.body = options.body ?? null
    this.requestId = options.requestId ?? null
  }
}

export class UniversaClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.UNIVERSA_API_BASE_URL ?? DEFAULT_BASE_URL)
    this.apiKey = options.apiKey ?? process.env.UNIVERSA_API_KEY ?? ''
    this.apiSecret = options.apiSecret ?? process.env.UNIVERSA_API_SECRET ?? ''
    this.fetch = options.fetchImpl ?? globalThis.fetch

    if (typeof this.fetch !== 'function') {
      throw new Error('A fetch implementation is required')
    }
  }

  assertConfigured() {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'UNIVERSA_API_KEY and UNIVERSA_API_SECRET are required for live Universa API calls',
      )
    }
  }

  async request(method, path, options = {}) {
    this.assertConfigured()
    const normalizedPath = normalizePath(path)
    const upperMethod = method.toUpperCase()
    const hasBody = upperMethod !== 'GET' && upperMethod !== 'HEAD'
    const bodyJson = hasBody ? JSON.stringify(options.body ?? {}) : ''
    const headers = this.authHeaders(upperMethod, normalizedPath, bodyJson)
    if (hasBody) headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json')
    headers.set('User-Agent', 'universa-agent-toolkit/0.1.0')

    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', String(options.idempotencyKey))
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }

    const response = await this.fetch(urlFor(this.baseUrl, normalizedPath), {
      method: upperMethod,
      headers,
      body: hasBody ? bodyJson : undefined,
    })
    const raw = await response.text()
    const body = raw ? parseJson(raw) : null
    if (!response.ok) {
      const message = body?.error?.message ?? `Universa API request failed with ${response.status}`
      throw new UniversaApiError(message, {
        status: response.status,
        code: body?.error?.code,
        body,
        requestId: response.headers.get('x-universa-request-id'),
      })
    }
    return {
      status: response.status,
      requestId: response.headers.get('x-universa-request-id'),
      body,
    }
  }

  authHeaders(method, path, bodyJson) {
    const timestamp = String(Date.now())
    const nonce = `agent_${timestamp}_${randomUUID()}`
    const bodyHash = sha256Hex(bodyJson)
    const canonical = [timestamp, nonce, method, path, bodyHash].join('\n')
    const signature = createHmac('sha256', this.apiSecret).update(canonical).digest('hex')
    return new Headers({
      'X-Universa-Api-Key': this.apiKey,
      'X-Universa-Timestamp': timestamp,
      'X-Universa-Nonce': nonce,
      'X-Universa-Signature': signature,
    })
  }

  createCustomer(input, options = {}) {
    return this.request('POST', '/v1/customers', {
      body: input,
      idempotencyKey: options.idempotencyKey,
    })
  }

  getCustomer(customerId) {
    return this.request('GET', `/v1/customers/${encodeURIComponent(customerId)}`)
  }

  createKycSession(customerId, options = {}) {
    return this.request('POST', `/v1/customers/${encodeURIComponent(customerId)}/kyc-sessions`, {
      idempotencyKey: options.idempotencyKey,
    })
  }

  getCustomerWallet(customerId) {
    return this.request('GET', `/v1/customers/${encodeURIComponent(customerId)}/wallet`)
  }

  createVirtualAccount(customerId, input, options = {}) {
    return this.request(
      'POST',
      `/v1/customers/${encodeURIComponent(customerId)}/virtual-accounts`,
      {
        body: input,
        idempotencyKey: options.idempotencyKey,
      },
    )
  }

  listVirtualAccounts(customerId) {
    return this.request('GET', `/v1/customers/${encodeURIComponent(customerId)}/virtual-accounts`)
  }

  createQuote(input, options = {}) {
    return this.request('POST', '/v1/quotes', {
      body: input,
      idempotencyKey: options.idempotencyKey,
    })
  }

  createTransfer(input, options = {}) {
    return this.request('POST', '/v1/transfers', {
      body: input,
      idempotencyKey: options.idempotencyKey,
    })
  }

  getTransfer(transferId) {
    return this.request('GET', `/v1/transfers/${encodeURIComponent(transferId)}`)
  }
}

export function createUniversaClient(options = {}) {
  return new UniversaClient(options)
}

export function agentIdempotencyKey(toolName, subject = 'request') {
  const cleanedSubject = String(subject).replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80)
  return `agent:${toolName}:${cleanedSubject}:${Date.now()}:${randomUUID()}`
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '')
}

function normalizePath(value) {
  const path = String(value || '/')
  return path.startsWith('/') ? path : `/${path}`
}

function urlFor(baseUrl, path) {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString()
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex')
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}
