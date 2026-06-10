import { ApiError, requireObject, requireString } from './errors.ts'
import { randomId } from './crypto.ts'
import { calculatePricing, quoteExpiry } from './pricing.ts'
import {
  providerForRequest,
  providerIdempotencyKey,
  type ProviderAdapter,
} from './provider.ts'
import type { PlatformCustomer, RequestContext } from './types.ts'

export class PlatformService {
  private provider: ProviderAdapter | null = null

  constructor(
    private readonly admin: any,
    private readonly context: RequestContext,
  ) {}

  async createCustomer(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    await this.enforceTenantRiskControls('customer')
    const type = requireString(body.type, 'type').toLowerCase()
    if (type !== 'individual' && type !== 'business') {
      throw new ApiError(400, 'invalid_request', 'type must be individual or business')
    }

    const customer = {
      id: randomId('cus'),
      tenant_id: this.context.tenant.id,
      external_id: requireString(body.external_id, 'external_id', { max: 200 }),
      type,
      full_name: requireString(body.full_name, 'full_name', { max: 200 }),
      email: requireString(body.email, 'email', {
        max: 320,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      }).toLowerCase(),
      country_code: requireString(body.country_code, 'country_code', {
        pattern: /^[A-Za-z]{2}$/,
      }).toUpperCase(),
      status: 'created',
      metadata: safeMetadata(body.metadata),
    }

    const { data, error } = await this.admin
      .from('platform_customers')
      .insert(customer)
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        throw new ApiError(
          409,
          'customer_already_exists',
          'external_id already exists for this tenant',
        )
      }
      throw error
    }

    await this.audit('customer.created', 'customer', data.id)
    return { status: 201, body: { customer: publicCustomer(data) } }
  }

  async getCustomer(customerId: string): Promise<{ status: number; body: unknown }> {
    const customer = await this.customer(customerId)
    return { status: 200, body: { customer: publicCustomer(customer) } }
  }

  async createKycSession(
    customerId: string,
  ): Promise<{ status: number; body: unknown }> {
    const customer = await this.customer(customerId)
    if (['closed', 'suspended'].includes(customer.status)) {
      throw new ApiError(409, 'customer_unavailable', 'Customer cannot start KYC')
    }

    const provider = await this.getProvider()
    const providerResult = await provider.createKycSession(
      customer,
      providerIdempotencyKey(this.context, 'kyc'),
    )
    if (!providerResult.providerCustomerId) {
      throw new ApiError(502, 'provider_response_invalid', 'Provider did not return a customer ID')
    }

    const sessionId = randomId('kyc')
    const normalizedStatus = customerStatusFromKyc(providerResult.status)
    const { data: session, error: sessionError } = await this.admin
      .from('kyc_sessions')
      .insert({
        id: sessionId,
        tenant_id: this.context.tenant.id,
        customer_id: customer.id,
        provider: provider.name,
        provider_session_id: providerResult.providerSessionId,
        status: providerResult.status,
        tos_url: providerResult.tosUrl,
        kyc_url: providerResult.kycUrl,
        expires_at: providerResult.expiresAt,
        provider_payload: {
          provider_customer_id: providerResult.providerCustomerId,
          status: providerResult.status,
        },
      })
      .select('*')
      .single()
    if (sessionError) throw sessionError

    const { data: updated, error: customerError } = await this.admin
      .from('platform_customers')
      .update({
        provider: provider.name,
        provider_customer_id: providerResult.providerCustomerId,
        provider_kyc_status: providerResult.status,
        status: normalizedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', customer.id)
      .select('*')
      .single()
    if (customerError) throw customerError

    await this.audit('kyc_session.created', 'kyc_session', session.id)
    return {
      status: 201,
      body: {
        kyc_session: publicKycSession(session),
        customer: publicCustomer(updated),
      },
    }
  }

  async createVirtualAccount(
    customerId: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const customer = await this.activeCustomer(customerId)
    const sourceCurrency = currency(body.source_currency, 'source_currency')
    const destination = requireObject(body.destination, 'destination')
    const destinationCurrency = currency(destination.currency, 'destination.currency')
    const destinationRail = requireString(
      destination.payment_rail,
      'destination.payment_rail',
      { max: 50 },
    ).toLowerCase()
    const destinationAddress = requireString(
      destination.address,
      'destination.address',
      { max: 256 },
    )

    const provider = await this.getProvider()
    assertCustomerProvider(customer, provider.name)
    const feePercent = formatBpsAsPercent(universaFeeBps() + defaultTenantFeeBps())
    const result = await provider.createVirtualAccount(
      customer,
      {
        sourceCurrency,
        destinationCurrency,
        destinationRail,
        destinationAddress,
        platformFeePercent: feePercent,
      },
      providerIdempotencyKey(this.context, 'virtual-account'),
    )

    const { data, error } = await this.admin
      .from('virtual_accounts')
      .insert({
        id: randomId('va'),
        tenant_id: this.context.tenant.id,
        customer_id: customer.id,
        provider: provider.name,
        provider_virtual_account_id: result.id,
        source_currency: result.sourceCurrency,
        source_rail: result.sourceRail,
        destination_currency: destinationCurrency,
        destination_rail: destinationRail,
        destination_address: destinationAddress,
        status: result.status,
        deposit_instructions: result.depositInstructions,
        fee_config: { developer_fee_percent: feePercent },
      })
      .select('*')
      .single()
    if (error) throw error

    await this.audit('virtual_account.created', 'virtual_account', data.id)
    return { status: 201, body: { virtual_account: publicVirtualAccount(data) } }
  }

  async listVirtualAccounts(customerId: string): Promise<{ status: number; body: unknown }> {
    await this.customer(customerId)
    const { data, error } = await this.admin
      .from('virtual_accounts')
      .select('*')
      .eq('tenant_id', this.context.tenant.id)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return {
      status: 200,
      body: { virtual_accounts: (data ?? []).map(publicVirtualAccount) },
    }
  }

  async createQuote(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const customerId = requireString(body.customer_id, 'customer_id')
    await this.activeCustomer(customerId)

    const kind = requireString(body.kind, 'kind').toLowerCase()
    if (kind !== 'onramp' && kind !== 'offramp') {
      throw new ApiError(400, 'invalid_request', 'kind must be onramp or offramp')
    }
    await this.enforceTenantRiskControls('quote')

    const source = requireObject(body.source, 'source')
    const destination = requireObject(body.destination, 'destination')
    const sourceCurrency = currency(source.currency, 'source.currency')
    const sourceRail = requireString(source.payment_rail, 'source.payment_rail', {
      max: 50,
    }).toLowerCase()
    const destinationCurrency = currency(destination.currency, 'destination.currency')
    const destinationRail = requireString(
      destination.payment_rail,
      'destination.payment_rail',
      { max: 50 },
    ).toLowerCase()
    const amount = requireString(body.amount, 'amount')
    enforceQuoteAmount(amount, this.context.tenant.risk_tier)
    const tenantFeeBps = readTenantFeeBps(body)
    const pricing = calculatePricing(amount, sourceCurrency, tenantFeeBps)

    const { data, error } = await this.admin
      .from('quotes')
      .insert({
        id: randomId('quo'),
        tenant_id: this.context.tenant.id,
        customer_id: customerId,
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
        destination_amount: pricing.destinationAmount,
        fee_currency: pricing.feeCurrency,
        pricing_version: pricing.pricingVersion,
        universa_fee_bps: pricing.universaFeeBps,
        tenant_fee_bps: pricing.tenantFeeBps,
        provider_fee_bps: pricing.providerFeeBps,
        expires_at: quoteExpiry(),
      })
      .select('*')
      .single()
    if (error) throw error

    await this.audit('quote.created', 'quote', data.id)
    return { status: 201, body: { quote: publicQuote(data) } }
  }

  async createTransfer(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const quoteId = requireString(body.quote_id, 'quote_id')
    const { data: quote, error: reserveError } = await this.admin
      .from('quotes')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', quoteId)
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
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

    const customer = await this.activeCustomer(quote.customer_id)
    const sourceInput = requireObject(body.source, 'source')
    const destinationInput = requireObject(body.destination, 'destination')
    const source = routeObject(sourceInput, quote.source_currency, quote.source_rail)
    const destination = routeObject(
      destinationInput,
      quote.destination_currency,
      quote.destination_rail,
    )
    const transferId = randomId('tr')
    const externalId = optionalString(body.external_id, 200)
    const clientReferenceId = `${this.context.tenant.id}:${transferId}`
    await this.enforceTenantRiskControls('transfer')

    try {
      const provider = await this.getProvider()
      assertCustomerProvider(customer, provider.name)
      const result = await provider.createTransfer(
        customer,
        {
          amount: String(quote.gross_amount),
          platformFee: String(quote.platform_fee),
          clientReferenceId,
          source,
          destination,
        },
        providerIdempotencyKey(this.context, `transfer:${quote.id}`),
      )

      const { data: transfer, error: transferError } = await this.admin
        .from('transfers')
        .insert({
          id: transferId,
          tenant_id: this.context.tenant.id,
          customer_id: customer.id,
          quote_id: quote.id,
          external_id: externalId,
          client_reference_id: clientReferenceId,
          provider: provider.name,
          provider_transfer_id: result.id,
          kind: quote.kind,
          status: normalizeTransferStatus(result.status),
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
          provider_payload: {
            state: result.status,
            source_deposit_instructions: result.sourceDepositInstructions,
          },
        })
        .select('*')
        .single()
      if (transferError) throw transferError

      const { error: quoteError } = await this.admin
        .from('quotes')
        .update({ status: 'consumed', updated_at: new Date().toISOString() })
        .eq('tenant_id', this.context.tenant.id)
        .eq('id', quote.id)
        .eq('status', 'processing')
      if (quoteError) throw quoteError

      await this.recordPlatformFee(transfer)
      await this.audit('transfer.created', 'transfer', transfer.id)
      return { status: 201, body: { transfer: publicTransfer(transfer) } }
    } catch (error) {
      await this.admin
        .from('quotes')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('tenant_id', this.context.tenant.id)
        .eq('id', quote.id)
        .eq('status', 'processing')
      throw error
    }
  }

  async getTransfer(transferId: string): Promise<{ status: number; body: unknown }> {
    const { data, error } = await this.admin
      .from('transfers')
      .select('*')
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', transferId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new ApiError(404, 'transfer_not_found', 'Transfer not found')
    return { status: 200, body: { transfer: publicTransfer(data) } }
  }

  private async customer(customerId: string): Promise<PlatformCustomer> {
    const { data, error } = await this.admin
      .from('platform_customers')
      .select('*')
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', customerId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new ApiError(404, 'customer_not_found', 'Customer not found')
    return data as PlatformCustomer
  }

  private async activeCustomer(customerId: string): Promise<PlatformCustomer> {
    const customer = await this.customer(customerId)
    if (customer.status !== 'active' || customer.provider_kyc_status !== 'active') {
      throw new ApiError(
        409,
        'customer_kyc_incomplete',
        'Customer must have active provider KYC before using this resource',
      )
    }
    return customer
  }

  private async getProvider(): Promise<ProviderAdapter> {
    this.provider ??= await providerForRequest(this.admin, this.context)
    return this.provider
  }

  private async recordPlatformFee(transfer: any): Promise<void> {
    if (Number(transfer.platform_fee) <= 0) return
    const transactionId = randomId('led')
    const { error: transactionError } = await this.admin
      .from('ledger_transactions')
      .insert({
        id: transactionId,
        tenant_id: this.context.tenant.id,
        transfer_id: transfer.id,
        description: 'Platform developer fee accrued',
      })
    if (transactionError) throw transactionError

    const { error: entriesError } = await this.admin.from('ledger_entries').insert([
      {
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'provider_fee_receivable',
        direction: 'debit',
        amount: transfer.platform_fee,
        currency: transfer.currency,
      },
      {
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'platform_fee_revenue',
        direction: 'credit',
        amount: transfer.platform_fee,
        currency: transfer.currency,
      },
    ])
    if (entriesError) throw entriesError
  }

  private async audit(
    action: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    await this.admin.from('audit_events').insert({
      tenant_id: this.context.tenant.id,
      actor_type: 'api_key',
      actor_id: this.context.apiKey.id,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details: { request_id: this.context.requestId },
    })
  }

  private async enforceTenantRiskControls(
    operation: 'customer' | 'quote' | 'transfer',
  ): Promise<void> {
    if (this.context.tenant.risk_tier === 'blocked') {
      throw new ApiError(403, 'tenant_blocked', 'Tenant is blocked by risk controls')
    }
    if (this.context.tenant.environment === 'sandbox') return
    if (this.context.tenant.kyb_status !== 'approved') {
      throw new ApiError(403, 'tenant_kyb_required', 'Production money movement requires approved tenant KYB')
    }
    if (this.context.tenant.risk_tier !== 'enhanced') return

    if (operation === 'customer') {
      await this.enforceHourlyLimit('platform_customers', 200, 'Tenant customer velocity limit exceeded')
    }
    if (operation === 'transfer') {
      await this.enforceHourlyLimit('transfers', 50, 'Tenant transfer velocity limit exceeded')
    }
  }

  private async enforceHourlyLimit(
    table: string,
    limit: number,
    message: string,
  ): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error } = await this.admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', this.context.tenant.id)
      .gte('created_at', since)
    if (error) throw error
    if ((count ?? 0) >= limit) {
      throw new ApiError(429, 'velocity_limit_exceeded', message)
    }
  }
}

function publicCustomer(customer: any): Record<string, unknown> {
  return {
    id: customer.id,
    external_id: customer.external_id,
    type: customer.type,
    full_name: customer.full_name,
    email: customer.email,
    country_code: customer.country_code,
    status: customer.status,
    provider: customer.provider,
    provider_kyc_status: customer.provider_kyc_status,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
    metadata: customer.metadata ?? {},
  }
}

function publicKycSession(session: any): Record<string, unknown> {
  return {
    id: session.id,
    customer_id: session.customer_id,
    provider: session.provider,
    status: session.status,
    tos_url: session.tos_url,
    kyc_url: session.kyc_url,
    expires_at: session.expires_at,
    created_at: session.created_at,
  }
}

function publicVirtualAccount(account: any): Record<string, unknown> {
  return {
    id: account.id,
    customer_id: account.customer_id,
    status: account.status,
    source_currency: account.source_currency,
    source_rail: account.source_rail,
    destination: {
      currency: account.destination_currency,
      payment_rail: account.destination_rail,
      address: account.destination_address,
    },
    deposit_instructions: account.deposit_instructions,
    fee_config: account.fee_config,
    created_at: account.created_at,
    updated_at: account.updated_at,
  }
}

function publicQuote(quote: any): Record<string, unknown> {
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
      partner: String(quote.provider_fee),
      provider: String(quote.provider_fee),
      universa: String(quote.universa_fee ?? 0),
      tenant: String(quote.tenant_fee ?? 0),
      platform: String(quote.platform_fee),
      network: String(quote.network_fee),
      currency: quote.fee_currency,
    },
    fee_bps: {
      partner: Number(quote.provider_fee_bps ?? 0),
      universa: Number(quote.universa_fee_bps ?? 0),
      tenant: Number(quote.tenant_fee_bps ?? 0),
      platform: Number(quote.universa_fee_bps ?? 0) + Number(quote.tenant_fee_bps ?? 0),
    },
    status: quote.status,
    expires_at: quote.expires_at,
    created_at: quote.created_at,
  }
}

function publicTransfer(transfer: any): Record<string, unknown> {
  return {
    id: transfer.id,
    external_id: transfer.external_id,
    customer_id: transfer.customer_id,
    quote_id: transfer.quote_id,
    kind: transfer.kind,
    status: transfer.status,
    source: transfer.source,
    destination: transfer.destination,
    amounts: {
      gross: String(transfer.gross_amount),
      partner_fee: String(transfer.provider_fee),
      provider_fee: String(transfer.provider_fee),
      universa_fee: String(transfer.universa_fee ?? 0),
      tenant_fee: String(transfer.tenant_fee ?? 0),
      platform_fee: String(transfer.platform_fee),
      network_fee: String(transfer.network_fee),
      destination: String(transfer.destination_amount),
      currency: transfer.currency,
    },
    source_deposit_instructions:
      transfer.provider_payload?.source_deposit_instructions ?? null,
    created_at: transfer.created_at,
    updated_at: transfer.updated_at,
  }
}

function customerStatusFromKyc(status: string): string {
  if (status === 'active') return 'active'
  if (status === 'rejected') return 'rejected'
  return 'kyc_pending'
}

function normalizeTransferStatus(status: string): string {
  const normalized = status.toLowerCase()
  const allowed = new Set([
    'created',
    'awaiting_funds',
    'funds_received',
    'in_review',
    'payment_submitted',
    'payment_processed',
    'failed',
    'returned',
    'refunded',
    'canceled',
  ])
  return allowed.has(normalized) ? normalized : 'created'
}

function currency(value: unknown, field: string): string {
  return requireString(value, field, { pattern: /^[A-Za-z0-9]{2,12}$/ }).toLowerCase()
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  const metadata = requireObject(value, 'metadata')
  const encoded = JSON.stringify(metadata)
  if (encoded.length > 10_000) {
    throw new ApiError(400, 'invalid_request', 'metadata is too large')
  }
  return metadata
}

function optionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, 'external_id', { max })
}

function routeObject(
  input: Record<string, unknown>,
  currencyValue: string,
  railValue: string,
): Record<string, unknown> {
  if (input.currency && String(input.currency).toLowerCase() !== currencyValue) {
    throw new ApiError(409, 'quote_route_mismatch', 'Currency does not match the quote')
  }
  if (input.payment_rail && String(input.payment_rail).toLowerCase() !== railValue) {
    throw new ApiError(409, 'quote_route_mismatch', 'Payment rail does not match the quote')
  }
  return {
    ...input,
    currency: currencyValue,
    payment_rail: railValue,
  }
}

function assertCustomerProvider(customer: PlatformCustomer, providerName: string): void {
  if (customer.provider !== providerName) {
    throw new ApiError(
      409,
      'customer_provider_mismatch',
      'Customer was onboarded with a different provider',
    )
  }
}

function formatBpsAsPercent(bps: number): string {
  return (bps / 100).toFixed(4).replace(/\.?0+$/, '') || '0'
}

function readTenantFeeBps(body: Record<string, unknown>): number {
  const value = body.tenant_fee_bps ?? body.developer_fee_bps
  if (value === undefined || value === null || value === '') return defaultTenantFeeBps()
  const parsed = Number(value)
  const max = envInteger('MAX_TENANT_FEE_BPS', 300)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new ApiError(400, 'invalid_fee', `tenant_fee_bps must be an integer from 0 to ${max}`)
  }
  return parsed
}

function enforceQuoteAmount(amount: string, riskTier: string): void {
  const parsed = Number(amount)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  const defaultLimit = riskTier === 'enhanced' ? 25000 : 100000
  const limit = envInteger('MAX_QUOTE_AMOUNT_UNITS', defaultLimit)
  if (parsed > limit) {
    throw new ApiError(400, 'amount_limit_exceeded', `amount exceeds the ${limit} per-quote limit`)
  }
}

function universaFeeBps(): number {
  return envInteger('UNIVERSA_FEE_BPS', 30)
}

function defaultTenantFeeBps(): number {
  return envInteger('DEFAULT_TENANT_FEE_BPS', 0)
}

function envInteger(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name) ?? fallback)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
