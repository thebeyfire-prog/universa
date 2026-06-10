import { ApiError } from './errors.ts'
import { randomId, sha256Hex } from './crypto.ts'
import type {
  PlatformCustomer,
  ProviderKycSession,
  ProviderName,
  ProviderTransfer,
  ProviderVirtualAccount,
  RequestContext,
} from './types.ts'

export type VirtualAccountInput = {
  sourceCurrency: string
  destinationCurrency: string
  destinationRail: string
  destinationAddress: string
  platformFeePercent: string
}

export type TransferInput = {
  amount: string
  platformFee: string
  clientReferenceId: string
  source: Record<string, unknown>
  destination: Record<string, unknown>
}

export interface ProviderAdapter {
  readonly name: ProviderName
  createKycSession(
    customer: PlatformCustomer,
    idempotencyKey: string,
  ): Promise<ProviderKycSession>
  createVirtualAccount(
    customer: PlatformCustomer,
    input: VirtualAccountInput,
    idempotencyKey: string,
  ): Promise<ProviderVirtualAccount>
  createTransfer(
    customer: PlatformCustomer,
    input: TransferInput,
    idempotencyKey: string,
  ): Promise<ProviderTransfer>
}

export async function providerForRequest(
  admin: any,
  context: RequestContext,
): Promise<ProviderAdapter> {
  const provider = (Deno.env.get('PLATFORM_PROVIDER') ?? 'mock').toLowerCase()
  if (provider !== 'mock' && provider !== 'partner') {
    throw new ApiError(500, 'provider_misconfigured', 'Unsupported platform provider')
  }

  const { data: config, error } = await admin
    .from('tenant_provider_configs')
    .select('status,approval_status')
    .eq('tenant_id', context.tenant.id)
    .eq('provider', provider)
    .maybeSingle()
  if (error) throw error
  if (!config || !['sandbox', 'active'].includes(config.status)) {
    throw new ApiError(403, 'provider_not_enabled', 'Provider is not enabled for this tenant')
  }
  if (provider === 'partner' && config.approval_status !== 'approved') {
    throw new ApiError(
      403,
      'provider_approval_required',
      'Institutional partner approval is required for this tenant',
    )
  }

  return provider === 'partner' ? new PartnerProvider() : new MockProvider()
}

class MockProvider implements ProviderAdapter {
  readonly name = 'mock' as const

  async createKycSession(
    customer: PlatformCustomer,
    idempotencyKey: string,
  ): Promise<ProviderKycSession> {
    const autoApprove = (Deno.env.get('MOCK_AUTO_APPROVE_KYC') ?? 'true') === 'true'
    const suffix = (await sha256Hex(idempotencyKey)).slice(0, 16)
    return {
      providerCustomerId: customer.provider_customer_id ?? `mock_cus_${suffix}`,
      providerSessionId: `mock_kyc_${suffix}`,
      status: autoApprove ? 'active' : 'pending',
      tosUrl: `https://example.invalid/mock/tos/${suffix}`,
      kycUrl: `https://example.invalid/mock/kyc/${suffix}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      raw: { mock: true, auto_approved: autoApprove },
    }
  }

  async createVirtualAccount(
    customer: PlatformCustomer,
    input: VirtualAccountInput,
    idempotencyKey: string,
  ): Promise<ProviderVirtualAccount> {
    const suffix = (await sha256Hex(idempotencyKey)).slice(0, 16)
    return {
      id: `mock_va_${suffix}`,
      status: 'active',
      sourceCurrency: input.sourceCurrency,
      sourceRail: mockRail(input.sourceCurrency),
      depositInstructions: mockDepositInstructions(input.sourceCurrency, customer.full_name, suffix),
      raw: { mock: true },
    }
  }

  async createTransfer(
    _customer: PlatformCustomer,
    input: TransferInput,
    idempotencyKey: string,
  ): Promise<ProviderTransfer> {
    const suffix = (await sha256Hex(idempotencyKey)).slice(0, 16)
    return {
      id: `mock_tr_${suffix}`,
      status: 'awaiting_funds',
      sourceDepositInstructions: {
        payment_rail: input.source.payment_rail ?? 'base',
        currency: input.source.currency,
        address: `0x${suffix.padEnd(40, '0')}`,
        amount: input.amount,
      },
      raw: { mock: true, client_reference_id: input.clientReferenceId },
    }
  }
}

class PartnerProvider implements ProviderAdapter {
  readonly name = 'partner' as const
  private readonly baseUrl = Deno.env.get('PARTNER_API_URL') ?? ''
  private readonly apiKey = Deno.env.get('PARTNER_API_KEY') ?? ''
  private readonly redirectUri = Deno.env.get('PARTNER_REDIRECT_URI') ?? ''

  constructor() {
    if (!this.baseUrl || !this.apiKey || !this.redirectUri) {
      throw new ApiError(500, 'provider_misconfigured', 'Partner credentials are not configured')
    }
  }

  async createKycSession(
    customer: PlatformCustomer,
    idempotencyKey: string,
  ): Promise<ProviderKycSession> {
    const body = await this.request('/kyc_links', {
      method: 'POST',
      idempotencyKey,
      body: {
        type: customer.type,
        full_name: customer.full_name,
        email: customer.email,
        endorsements: [endorsementForCountry(customer.country_code)],
        redirect_uri: this.redirectUri,
      },
    })
    return {
      providerCustomerId: String(body.customer_id ?? ''),
      providerSessionId: body.id ? String(body.id) : null,
      status: normalizePartnerCustomerStatus(body.kyc_status ?? body.status),
      tosUrl: body.tos_link ? String(body.tos_link) : null,
      kycUrl: body.kyc_link ? String(body.kyc_link) : null,
      expiresAt: body.expires_at ? String(body.expires_at) : null,
      raw: body,
    }
  }

  async createVirtualAccount(
    customer: PlatformCustomer,
    input: VirtualAccountInput,
    idempotencyKey: string,
  ): Promise<ProviderVirtualAccount> {
    if (!customer.provider_customer_id) {
      throw new ApiError(409, 'provider_customer_missing', 'Provider customer is not provisioned')
    }
    const body = await this.request(
      `/customers/${customer.provider_customer_id}/virtual_accounts`,
      {
        method: 'POST',
        idempotencyKey,
        body: {
          source: { currency: input.sourceCurrency },
          destination: {
            currency: input.destinationCurrency,
            payment_rail: input.destinationRail,
            address: input.destinationAddress,
          },
          developer_fee_percent: input.platformFeePercent,
        },
      },
    )
    const instructions = objectValue(body.source_deposit_instructions)
    const rail = instructions.payment_rail
      ?? (Array.isArray(instructions.payment_rails) ? instructions.payment_rails[0] : null)
    return {
      id: String(body.id),
      status: ['active', 'activated'].includes(String(body.status)) ? 'active' : 'pending',
      sourceCurrency: String(instructions.currency ?? input.sourceCurrency),
      sourceRail: rail ? String(rail) : null,
      depositInstructions: instructions,
      raw: body,
    }
  }

  async createTransfer(
    customer: PlatformCustomer,
    input: TransferInput,
    idempotencyKey: string,
  ): Promise<ProviderTransfer> {
    if (!customer.provider_customer_id) {
      throw new ApiError(409, 'provider_customer_missing', 'Provider customer is not provisioned')
    }
    const body = await this.request('/transfers', {
      method: 'POST',
      idempotencyKey,
      body: {
        on_behalf_of: customer.provider_customer_id,
        client_reference_id: input.clientReferenceId,
        amount: input.amount,
        developer_fee: input.platformFee,
        source: input.source,
        destination: input.destination,
      },
    })
    return {
      id: String(body.id),
      status: String(body.state ?? body.status ?? 'created'),
      sourceDepositInstructions: body.source_deposit_instructions
        ? objectValue(body.source_deposit_instructions)
        : null,
      raw: body,
    }
  }

  private async request(
    path: string,
    options: {
      method: 'POST'
      idempotencyKey: string
      body: Record<string, unknown>
    },
  ): Promise<Record<string, any>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey.slice(0, 64),
      },
      body: JSON.stringify(options.body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new ApiError(
        response.status >= 500 ? 502 : response.status,
        'provider_request_failed',
        'Provider rejected the request',
        payload,
      )
    }
    return payload
  }
}

export function providerIdempotencyKey(
  context: RequestContext,
  operation: string,
): string {
  return [
    operation,
    context.tenant.id,
    context.idempotencyKey ?? randomId('idem'),
  ].join(':')
}

function endorsementForCountry(countryCode: string): string {
  const country = countryCode.toUpperCase()
  if (country === 'BR') return 'pix'
  if (country === 'MX') return 'spei'
  if (country === 'GB') return 'faster_payments'
  if (country === 'CO') return 'cop'
  if (new Set([
    'AT', 'BE', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
    'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL',
    'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'CH',
  ]).has(country)) return 'sepa'
  return 'base'
}

function normalizePartnerCustomerStatus(value: unknown): string {
  const status = String(value ?? '').toLowerCase()
  if (status === 'active' || status === 'approved') return 'active'
  if (status === 'rejected' || status === 'offboarded') return 'rejected'
  return 'pending'
}

function mockRail(currency: string): string {
  const normalized = currency.toLowerCase()
  if (normalized === 'usd') return 'ach'
  if (normalized === 'eur') return 'sepa'
  if (normalized === 'gbp') return 'faster_payments'
  if (normalized === 'brl') return 'pix'
  if (normalized === 'mxn') return 'spei'
  if (normalized === 'cop') return 'bre_b'
  return 'bank_transfer'
}

function mockDepositInstructions(
  currency: string,
  beneficiary: string,
  suffix: string,
): Record<string, unknown> {
  const rail = mockRail(currency)
  return {
    currency: currency.toLowerCase(),
    payment_rail: rail,
    bank_name: 'Universa Sandbox Bank',
    beneficiary_name: beneficiary,
    account_number: suffix.slice(0, 12),
    routing_number: '000000000',
    reference: `MONET-${suffix.toUpperCase()}`,
  }
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}
