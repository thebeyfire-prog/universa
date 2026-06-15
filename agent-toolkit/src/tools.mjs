import { agentIdempotencyKey, createUniversaClient } from './client.mjs'

export const UNIVERSA_AGENT_TOOLS = [
  {
    name: 'universa_healthcheck',
    description: 'Check local Universa Agent Toolkit configuration without sending money or creating records.',
    inputSchema: objectSchema({}),
    readOnly: true,
  },
  {
    name: 'universa_create_customer',
    description: 'Draft or create a Universa customer. Live execution requires execute=true.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      external_id: stringSchema('Tenant-scoped customer reference.'),
      type: enumSchema(['individual', 'business'], 'Customer type.'),
      full_name: stringSchema('Legal or business name.'),
      email: stringSchema('Customer email address.'),
      country_code: stringSchema('Two-letter ISO country code.'),
      metadata: { type: 'object', additionalProperties: true },
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['external_id', 'type', 'full_name', 'email', 'country_code']),
    mutates: true,
  },
  {
    name: 'universa_get_customer',
    description: 'Fetch a Universa customer and assigned wallet summary.',
    inputSchema: objectSchema({
      customer_id: stringSchema('Universa customer ID.'),
    }, ['customer_id']),
    readOnly: true,
  },
  {
    name: 'universa_create_kyc_session',
    description: 'Draft or create a hosted KYC session. Live execution requires execute=true.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      customer_id: stringSchema('Universa customer ID.'),
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['customer_id']),
    mutates: true,
  },
  {
    name: 'universa_get_customer_wallet',
    description: 'Get the active customer Solana wallet assigned by Universa.',
    inputSchema: objectSchema({
      customer_id: stringSchema('Universa customer ID.'),
    }, ['customer_id']),
    readOnly: true,
  },
  {
    name: 'universa_create_virtual_account',
    description: 'Draft or create a virtual account that settles to the assigned Solana USDC wallet. Live execution requires execute=true.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      customer_id: stringSchema('Universa customer ID.'),
      source_currency: stringSchema('Fiat source currency, for example usd.'),
      destination_address: stringSchema('Optional Solana destination address. Must match assigned customer wallet if supplied.'),
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['customer_id', 'source_currency']),
    mutates: true,
  },
  {
    name: 'universa_list_virtual_accounts',
    description: 'List virtual accounts for a Universa customer.',
    inputSchema: objectSchema({
      customer_id: stringSchema('Universa customer ID.'),
    }, ['customer_id']),
    readOnly: true,
  },
  {
    name: 'universa_prepare_usdc_payout_account',
    description: 'Agent shortcut for drafting or creating a USD virtual account that settles to the customer Solana USDC wallet.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      customer_id: stringSchema('Universa customer ID.'),
      source_currency: stringSchema('Source fiat currency. Defaults to usd.'),
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['customer_id']),
    mutates: true,
  },
  {
    name: 'universa_create_quote',
    description: 'Draft or create a route quote. Live execution requires execute=true.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      customer_id: stringSchema('Universa customer ID.'),
      kind: enumSchema(['onramp', 'offramp'], 'Quote kind.'),
      amount: stringSchema('Decimal amount as a string.'),
      tenant_fee_bps: numberSchema('Optional tenant markup in basis points.'),
      source: routeSchema('Source route.'),
      destination: routeSchema('Destination route.'),
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['customer_id', 'kind', 'amount', 'source', 'destination']),
    mutates: true,
  },
  {
    name: 'universa_create_transfer',
    description: 'Draft or execute a quoted transfer. Live execution requires execute=true.',
    inputSchema: objectSchema({
      execute: booleanSchema('When false, return a signed-call preview only. Defaults to false.'),
      quote_id: stringSchema('Universa quote ID.'),
      external_id: stringSchema('Optional tenant transfer reference.'),
      source: routeSchema('Source route.'),
      destination: routeSchema('Destination route.'),
      idempotency_key: stringSchema('Optional idempotency key for the API request.'),
    }, ['quote_id', 'source', 'destination']),
    mutates: true,
  },
  {
    name: 'universa_get_transfer',
    description: 'Fetch a Universa transfer by ID.',
    inputSchema: objectSchema({
      transfer_id: stringSchema('Universa transfer ID.'),
    }, ['transfer_id']),
    readOnly: true,
  },
]

export async function runUniversaAgentTool(name, input = {}, options = {}) {
  const args = input && typeof input === 'object' ? input : {}
  const client = options.client ?? createUniversaClient(options.clientOptions ?? {})

  switch (name) {
    case 'universa_healthcheck':
      return healthcheck(client)
    case 'universa_create_customer':
      return mutation(args, 'universa_create_customer', 'POST', '/v1/customers', {
        external_id: requireString(args.external_id, 'external_id'),
        type: requireString(args.type, 'type'),
        full_name: requireString(args.full_name, 'full_name'),
        email: requireString(args.email, 'email'),
        country_code: requireString(args.country_code, 'country_code'),
        ...(args.metadata ? { metadata: requirePlainObject(args.metadata, 'metadata') } : {}),
      }, (body, request) => client.createCustomer(body, request))
    case 'universa_get_customer':
      return liveResult(await client.getCustomer(requireString(args.customer_id, 'customer_id')))
    case 'universa_create_kyc_session': {
      const customerId = requireString(args.customer_id, 'customer_id')
      return mutation(args, 'universa_create_kyc_session', 'POST', `/v1/customers/${encodeURIComponent(customerId)}/kyc-sessions`, {}, (_, request) => client.createKycSession(customerId, request))
    }
    case 'universa_get_customer_wallet':
      return liveResult(await client.getCustomerWallet(requireString(args.customer_id, 'customer_id')))
    case 'universa_create_virtual_account': {
      const customerId = requireString(args.customer_id, 'customer_id')
      const body = virtualAccountBody(args)
      return mutation(args, 'universa_create_virtual_account', 'POST', `/v1/customers/${encodeURIComponent(customerId)}/virtual-accounts`, body, (requestBody, request) => client.createVirtualAccount(customerId, requestBody, request))
    }
    case 'universa_list_virtual_accounts':
      return liveResult(await client.listVirtualAccounts(requireString(args.customer_id, 'customer_id')))
    case 'universa_prepare_usdc_payout_account': {
      const customerId = requireString(args.customer_id, 'customer_id')
      const body = {
        source_currency: String(args.source_currency ?? 'usd').toLowerCase(),
        destination: { currency: 'usdc', payment_rail: 'solana' },
      }
      return mutation(args, 'universa_prepare_usdc_payout_account', 'POST', `/v1/customers/${encodeURIComponent(customerId)}/virtual-accounts`, body, (requestBody, request) => client.createVirtualAccount(customerId, requestBody, request))
    }
    case 'universa_create_quote': {
      const body = {
        customer_id: requireString(args.customer_id, 'customer_id'),
        kind: requireString(args.kind, 'kind'),
        amount: requireString(args.amount, 'amount'),
        source: route(args.source, 'source'),
        destination: route(args.destination, 'destination'),
        ...(args.tenant_fee_bps !== undefined ? { tenant_fee_bps: Number(args.tenant_fee_bps) } : {}),
      }
      return mutation(args, 'universa_create_quote', 'POST', '/v1/quotes', body, (requestBody, request) => client.createQuote(requestBody, request))
    }
    case 'universa_create_transfer': {
      const body = {
        quote_id: requireString(args.quote_id, 'quote_id'),
        source: route(args.source, 'source'),
        destination: route(args.destination, 'destination'),
        ...(args.external_id ? { external_id: String(args.external_id) } : {}),
      }
      return mutation(args, 'universa_create_transfer', 'POST', '/v1/transfers', body, (requestBody, request) => client.createTransfer(requestBody, request))
    }
    case 'universa_get_transfer':
      return liveResult(await client.getTransfer(requireString(args.transfer_id, 'transfer_id')))
    default:
      throw new Error(`Unknown Universa agent tool: ${name}`)
  }
}

export function toolResultToMcp(result) {
  const text = JSON.stringify(result, null, 2)
  return {
    content: [{ type: 'text', text }],
    structuredContent: result,
  }
}

function healthcheck(client) {
  return {
    ok: true,
    toolkit: 'universa-agent-toolkit',
    version: '0.1.0',
    base_url: client.baseUrl,
    live_calls_configured: Boolean(client.apiKey && client.apiSecret),
    safety: {
      mutating_tools_default_to_dry_run: true,
      live_mutations_require_execute_true: true,
    },
  }
}

async function mutation(args, toolName, method, path, body, liveCall) {
  const idempotencyKey = args.idempotency_key
    ? String(args.idempotency_key)
    : agentIdempotencyKey(toolName, body.customer_id ?? args.customer_id ?? body.quote_id ?? 'request')
  const request = {
    method,
    path,
    body,
    idempotencyKey,
  }

  if (args.execute !== true) {
    return {
      ok: true,
      mode: 'dry_run',
      requires_approval: true,
      approval_hint: 'Set execute=true to send this request to the Universa API.',
      request,
    }
  }

  const response = await liveCall(body, { idempotencyKey })
  return {
    ok: true,
    mode: 'executed',
    request: {
      method,
      path,
      idempotencyKey,
    },
    response: response.body,
    status: response.status,
    request_id: response.requestId,
  }
}

function liveResult(response) {
  return {
    ok: true,
    mode: 'read',
    response: response.body,
    status: response.status,
    request_id: response.requestId,
  }
}

function virtualAccountBody(args) {
  const destination = { currency: 'usdc', payment_rail: 'solana' }
  if (args.destination_address) destination.address = String(args.destination_address)
  return {
    source_currency: requireString(args.source_currency, 'source_currency').toLowerCase(),
    destination,
  }
}

function route(value, field) {
  const object = requirePlainObject(value, field)
  return {
    currency: requireString(object.currency, `${field}.currency`).toLowerCase(),
    payment_rail: requireString(object.payment_rail, `${field}.payment_rail`).toLowerCase(),
    ...(object.address ? { address: String(object.address) } : {}),
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function requirePlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }
}

function stringSchema(description) {
  return { type: 'string', description }
}

function booleanSchema(description) {
  return { type: 'boolean', description, default: false }
}

function numberSchema(description) {
  return { type: 'number', description }
}

function enumSchema(values, description) {
  return { type: 'string', enum: values, description }
}

function routeSchema(description) {
  return {
    type: 'object',
    description,
    additionalProperties: true,
    required: ['currency', 'payment_rail'],
    properties: {
      currency: stringSchema('Currency code, for example usd or usdc.'),
      payment_rail: stringSchema('Payment rail, for example ach, wire, solana, or assigned_customer_wallet.'),
      address: stringSchema('Optional destination/source address or account reference.'),
    },
  }
}
