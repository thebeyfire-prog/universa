import { ApiError, requireObject, requireString } from './errors.ts'
import { randomId } from './crypto.ts'
import { calculatePricing, quoteExpiry } from './pricing.ts'
import {
  providerForRequest,
  providerIdempotencyKey,
  type ProviderAdapter,
} from './provider.ts'
import { createPrivySolanaWallet, exportPrivySolanaWallet } from './privy.ts'
import type { PlatformCustomer, PlatformCustomerWallet, RequestContext } from './types.ts'
import {
  matchesWebhookSubscription,
  webhookEventPayload,
  webhookEventType,
  type WebhookResourceType,
} from './webhooks.ts'

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
    await this.recordStateEvent('customer', data.id, null, data.status, 'api', {
      external_id: data.external_id,
      customer_type: data.type,
      country_code: data.country_code,
    })
    return { status: 201, body: { customer: publicCustomer(data) } }
  }

  async getCustomer(customerId: string): Promise<{ status: number; body: unknown }> {
    const customer = await this.customer(customerId)
    const wallet = await this.findCustomerWallet(customer.id)
    return { status: 200, body: { customer: publicCustomer(customer, wallet) } }
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
    const nowIso = new Date().toISOString()
    const providerRawStatus = providerStatusRaw(providerResult.raw, providerResult.status)
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
        tos_status: kycTosStatus(providerResult),
        tos_url_issued_at: providerResult.tosUrl ? nowIso : null,
        kyc_url_issued_at: providerResult.kycUrl ? nowIso : null,
        provider_status_raw: providerRawStatus,
        last_provider_sync_at: nowIso,
        provider_payload: {
          provider_customer_id: providerResult.providerCustomerId,
          status: providerResult.status,
          raw: providerResult.raw,
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
        provider_status_raw: providerRawStatus,
        status: normalizedStatus,
        last_provider_sync_at: nowIso,
        ...kycCustomerTimestampPatch(customer, normalizedStatus, nowIso),
        updated_at: nowIso,
      })
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', customer.id)
      .select('*')
      .single()
    if (customerError) throw customerError

    await this.audit('kyc_session.created', 'kyc_session', session.id)
    await this.recordStateEvent('kyc_session', session.id, null, session.status, 'provider', {
      customer_id: customer.id,
      provider: provider.name,
      provider_session_id: providerResult.providerSessionId,
      provider_customer_id: providerResult.providerCustomerId,
      provider_status_raw: providerRawStatus,
    })
    await this.recordStateEvent('customer', customer.id, customer.status, updated.status, 'provider', {
      kyc_session_id: session.id,
      provider: provider.name,
      provider_customer_id: providerResult.providerCustomerId,
      provider_status_raw: providerRawStatus,
    })
    const customerWallet = updated.status === 'active' && updated.provider_kyc_status === 'active'
      ? await this.ensureCustomerWallet(updated as PlatformCustomer)
      : null
    return {
      status: 201,
      body: {
        kyc_session: publicKycSession(session),
        customer: publicCustomer(updated, customerWallet),
        customer_wallet: customerWallet ? publicCustomerWallet(customerWallet) : null,
      },
    }
  }

  async createVirtualAccount(
    customerId: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const customer = await this.activeCustomer(customerId)
    const customerWallet = await this.ensureCustomerWallet(customer)
    const sourceCurrency = currency(body.source_currency, 'source_currency')
    const destination = optionalObject(body.destination, 'destination')
    const destinationCurrency = destination?.currency === undefined
      ? 'usdc'
      : currency(destination.currency, 'destination.currency')
    const destinationRail = destination?.payment_rail === undefined
      ? 'solana'
      : requireString(destination.payment_rail, 'destination.payment_rail', { max: 50 }).toLowerCase()
    if (destinationCurrency !== 'usdc' || destinationRail !== 'solana') {
      throw new ApiError(
        400,
        'unsupported_virtual_account_destination',
        'Virtual accounts settle to the assigned customer Solana USDC wallet',
      )
    }
    const requestedAddress = optionalFieldString(destination?.address, 'destination.address', 256)
    if (requestedAddress && requestedAddress !== customerWallet.wallet_address) {
      throw new ApiError(
        409,
        'destination_wallet_mismatch',
        'Virtual account destination must match the assigned customer wallet',
      )
    }
    const destinationAddress = customerWallet.wallet_address

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
        provider_status_raw: providerStatusRaw(result.raw, result.status),
        last_provider_sync_at: new Date().toISOString(),
        deposit_instructions: result.depositInstructions,
        fee_config: {
          developer_fee_percent: feePercent,
          customer_wallet_id: customerWallet.id,
        },
      })
      .select('*')
      .single()
    if (error) throw error

    await this.audit('virtual_account.created', 'virtual_account', data.id)
    await this.recordStateEvent('virtual_account', data.id, null, data.status, 'provider', {
      customer_id: customer.id,
      provider: provider.name,
      provider_virtual_account_id: result.id,
      source_currency: result.sourceCurrency,
      destination_currency: destinationCurrency,
      destination_rail: destinationRail,
      customer_wallet_id: customerWallet.id,
    })
    return {
      status: 201,
      body: {
        virtual_account: publicVirtualAccount(data),
        customer_wallet: publicCustomerWallet(customerWallet),
      },
    }
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

  async getCustomerWallet(customerId: string): Promise<{ status: number; body: unknown }> {
    const customer = await this.activeCustomer(customerId)
    const wallet = await this.ensureCustomerWallet(customer)
    return { status: 200, body: { customer_wallet: publicCustomerWallet(wallet) } }
  }

  async exportCustomerWallet(
    customerId: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const customer = await this.activeCustomer(customerId)
    const wallet = await this.ensureCustomerWallet(customer)
    if (wallet.status !== 'active') {
      throw new ApiError(409, 'wallet_unavailable', 'Customer wallet is not active')
    }

    const recipientPublicKey = requireString(body.recipient_public_key, 'recipient_public_key', {
      max: 4096,
    })
    const walletExport = await exportPrivySolanaWallet(wallet.privy_wallet_id, recipientPublicKey)
    const exportedAt = new Date().toISOString()
    const { data: updated, error } = await this.admin
      .from('platform_customer_wallets')
      .update({ exported_at: exportedAt, updated_at: exportedAt })
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', wallet.id)
      .select('*')
      .single()
    if (error) throw error

    await this.audit('customer_wallet.exported', 'customer_wallet', wallet.id)
    return {
      status: 200,
      body: {
        customer_wallet: publicCustomerWallet(updated),
        wallet_export: {
          provider: 'privy',
          encryption_type: 'HPKE',
          encapsulated_key: walletExport.encapsulated_key ?? null,
          ciphertext: walletExport.ciphertext ?? null,
        },
      },
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
    await this.recordStateEvent('quote', data.id, null, data.status, 'api', {
      customer_id: customerId,
      kind,
      source_currency: sourceCurrency,
      source_rail: sourceRail,
      destination_currency: destinationCurrency,
      destination_rail: destinationRail,
      gross_amount: String(data.gross_amount),
      destination_amount: String(data.destination_amount),
    })
    return { status: 201, body: { quote: publicQuote(data) } }
  }

  async createTransfer(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const quoteId = requireString(body.quote_id, 'quote_id')
    const reserveAt = new Date().toISOString()
    const { data: quote, error: reserveError } = await this.admin
      .from('quotes')
      .update({ status: 'processing', processing_at: reserveAt, updated_at: reserveAt })
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
    let source = routeObject(sourceInput, quote.source_currency, quote.source_rail)
    let destination = routeObject(
      destinationInput,
      quote.destination_currency,
      quote.destination_rail,
    )
    const needsAssignedWallet = isAssignedWalletRoute(source) || isAssignedWalletRoute(destination)
    const customerWallet = needsAssignedWallet ? await this.ensureCustomerWallet(customer) : null
    if (customerWallet && isAssignedWalletRoute(source)) {
      source = withAssignedCustomerWallet(source, sourceInput, customerWallet, 'source')
    }
    if (customerWallet && isAssignedWalletRoute(destination)) {
      destination = withAssignedCustomerWallet(
        destination,
        destinationInput,
        customerWallet,
        'destination',
      )
    }
    const transferId = randomId('tr')
    const externalId = optionalString(body.external_id, 200)
    const clientReferenceId = `${this.context.tenant.id}:${transferId}`
    await this.enforceTenantRiskControls('transfer')

    try {
      const provider = await this.getProvider()
      assertCustomerProvider(customer, provider.name)
      const providerSyncAt = new Date().toISOString()
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
          provider_status_raw: providerStatusRaw(result.raw, result.status),
          last_provider_sync_at: providerSyncAt,
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
          settlement_status: Number(quote.platform_fee) > 0
            ? 'pending_provider_settlement'
            : 'not_applicable',
          provider_payload: {
            state: result.status,
            source_deposit_instructions: result.sourceDepositInstructions,
            raw: result.raw,
            ownership: ownershipSnapshot({
              tenantId: this.context.tenant.id,
              customer,
              quoteId: quote.id,
              transferId,
              clientReferenceId,
              providerCustomerId: customer.provider_customer_id,
            }),
          },
          reconciliation_details: {
            ownership: ownershipSnapshot({
              tenantId: this.context.tenant.id,
              customer,
              quoteId: quote.id,
              transferId,
              clientReferenceId,
              providerCustomerId: customer.provider_customer_id,
            }),
          },
        })
        .select('*')
        .single()
      if (transferError) throw transferError

      const consumedAt = new Date().toISOString()
      const { error: quoteError } = await this.admin
        .from('quotes')
        .update({ status: 'consumed', consumed_at: consumedAt, updated_at: consumedAt })
        .eq('tenant_id', this.context.tenant.id)
        .eq('id', quote.id)
        .eq('status', 'processing')
      if (quoteError) throw quoteError

      await this.recordPlatformFee(transfer)
      await this.audit('transfer.created', 'transfer', transfer.id)
      await this.recordStateEvent('quote', quote.id, 'open', 'processing', 'api', {
        customer_id: customer.id,
        transfer_id: transfer.id,
        reserved_at: reserveAt,
      })
      await this.recordStateEvent('quote', quote.id, 'processing', 'consumed', 'api', {
        customer_id: customer.id,
        transfer_id: transfer.id,
        consumed_at: consumedAt,
      })
      await this.recordStateEvent('transfer', transfer.id, null, transfer.status, 'provider', {
        customer_id: customer.id,
        quote_id: quote.id,
        provider: provider.name,
        provider_transfer_id: result.id,
        provider_status_raw: providerStatusRaw(result.raw, result.status),
        client_reference_id: clientReferenceId,
      })
      return { status: 201, body: { transfer: publicTransfer(transfer) } }
    } catch (error) {
      const reopenedAt = new Date().toISOString()
      await this.admin
        .from('quotes')
        .update({ status: 'open', updated_at: reopenedAt })
        .eq('tenant_id', this.context.tenant.id)
        .eq('id', quote.id)
        .eq('status', 'processing')
      await this.recordStateEvent('quote', quote.id, 'processing', 'open', 'system', {
        customer_id: customer.id,
        reopened_at: reopenedAt,
        reason: 'transfer_create_failed',
      })
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

  private async findCustomerWallet(customerId: string): Promise<PlatformCustomerWallet | null> {
    const { data, error } = await this.admin
      .from('platform_customer_wallets')
      .select('*')
      .eq('tenant_id', this.context.tenant.id)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (error) throw error
    return data as PlatformCustomerWallet | null
  }

  private async ensureCustomerWallet(customer: PlatformCustomer): Promise<PlatformCustomerWallet> {
    const existing = await this.findCustomerWallet(customer.id)
    if (existing) return existing
    if (customer.status !== 'active' || customer.provider_kyc_status !== 'active') {
      throw new ApiError(
        409,
        'customer_kyc_incomplete',
        'Customer must have active provider KYC before a wallet can be assigned',
      )
    }

    const providerWallet = await createPrivySolanaWallet({
      tenant_id: this.context.tenant.id,
      customer_id: customer.id,
      customer_external_id: customer.external_id,
    })
    const nowIso = new Date().toISOString()
    const { data, error } = await this.admin
      .from('platform_customer_wallets')
      .insert({
        id: randomId('cwal'),
        tenant_id: this.context.tenant.id,
        customer_id: customer.id,
        wallet_provider: 'privy',
        privy_app_id: providerWallet.appId,
        privy_wallet_id: providerWallet.id,
        wallet_address: providerWallet.address,
        chain: 'solana',
        custody_model: 'privy_server_wallet',
        status: 'active',
        assigned_at: nowIso,
        provider_payload: providerWallet.raw,
        metadata: {
          customer_external_id: customer.external_id,
          provider_customer_id: customer.provider_customer_id,
          mock: providerWallet.mock,
        },
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        const raced = await this.findCustomerWallet(customer.id)
        if (raced) return raced
      }
      throw error
    }

    await this.audit('customer_wallet.assigned', 'customer_wallet', data.id)
    await this.recordStateEvent('customer_wallet', data.id, null, data.status, 'api', {
      customer_id: customer.id,
      provider: 'privy',
      provider_wallet_id: providerWallet.id,
      wallet_address: providerWallet.address,
      chain: 'solana',
      custody_model: 'privy_server_wallet',
    })
    return data as PlatformCustomerWallet
  }

  private async getProvider(): Promise<ProviderAdapter> {
    this.provider ??= await providerForRequest(this.admin, this.context)
    return this.provider
  }

  private async recordPlatformFee(transfer: any): Promise<void> {
    if (Number(transfer.platform_fee) <= 0) {
      await this.admin
        .from('transfers')
        .update({ settlement_status: 'not_applicable' })
        .eq('tenant_id', this.context.tenant.id)
        .eq('id', transfer.id)
      return
    }
    const transactionId = randomId('led')
    const { error: transactionError } = await this.admin
      .from('ledger_transactions')
      .insert({
        id: transactionId,
        tenant_id: this.context.tenant.id,
        transfer_id: transfer.id,
        transaction_type: 'transfer_fee_accrual',
        description: 'Transfer fee accrued pending provider settlement',
        metadata: {
          provider: transfer.provider,
          provider_transfer_id: transfer.provider_transfer_id,
          kind: transfer.kind,
          customer_id: transfer.customer_id,
          universa_fee: String(transfer.universa_fee ?? 0),
          tenant_fee: String(transfer.tenant_fee ?? 0),
          platform_fee: String(transfer.platform_fee ?? 0),
        },
      })
    if (transactionError) throw transactionError

    const entries = [
      {
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'provider_fee_receivable',
        direction: 'debit',
        amount: transfer.platform_fee,
        currency: transfer.currency,
      }
    ]
    if (Number(transfer.universa_fee ?? 0) > 0) {
      entries.push({
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'universa_fee_revenue',
        direction: 'credit',
        amount: transfer.universa_fee,
        currency: transfer.currency,
      })
    }
    if (Number(transfer.tenant_fee ?? 0) > 0) {
      entries.push({
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'tenant_fee_payable',
        direction: 'credit',
        amount: transfer.tenant_fee,
        currency: transfer.currency,
      })
    }
    const credited = Number(transfer.universa_fee ?? 0) + Number(transfer.tenant_fee ?? 0)
    const residual = Math.max(Number(transfer.platform_fee ?? 0) - credited, 0)
    if (residual > 0) {
      entries.push({
        ledger_transaction_id: transactionId,
        tenant_id: this.context.tenant.id,
        account_code: 'platform_fee_revenue',
        direction: 'credit',
        amount: residual.toFixed(2),
        currency: transfer.currency,
      })
    }

    const { error: entriesError } = await this.admin.from('ledger_entries').insert(entries)
    if (entriesError) throw entriesError

    await this.admin
      .from('transfers')
      .update({
        settlement_status: 'pending_provider_settlement',
        settlement_details: {
          fee_accrual_ledger_transaction_id: transactionId,
          provider: transfer.provider,
          provider_transfer_id: transfer.provider_transfer_id,
        },
      })
      .eq('tenant_id', this.context.tenant.id)
      .eq('id', transfer.id)
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

  private async recordStateEvent(
    resourceType: WebhookResourceType,
    resourceId: string,
    previousStatus: string | null,
    nextStatus: string,
    source: 'api' | 'dashboard' | 'provider' | 'provider_webhook' | 'reconciliation' | 'system',
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const provider = typeof details.provider === 'string' ? details.provider : null
    const providerResourceId = firstString(
      details.provider_wallet_id,
      details.provider_transfer_id,
      details.provider_customer_id,
      details.provider_session_id,
      details.provider_virtual_account_id,
    )
    const { error } = await this.admin.from('platform_state_events').insert({
      tenant_id: this.context.tenant.id,
      resource_type: resourceType,
      resource_id: resourceId,
      previous_status: previousStatus,
      next_status: nextStatus,
      source,
      provider,
      provider_resource_id: providerResourceId,
      request_id: this.context.requestId,
      idempotency_key: this.context.idempotencyKey,
      details,
    })
    if (error) {
      console.error('[platform-api] state event failed', {
        resourceType,
        resourceId,
        requestId: this.context.requestId,
        error,
      })
      return
    }

    await this.enqueueWebhookEvent(
      resourceType,
      resourceId,
      previousStatus,
      nextStatus,
      source,
      provider,
      providerResourceId,
      details,
    )
  }

  private async enqueueWebhookEvent(
    resourceType: WebhookResourceType,
    resourceId: string,
    previousStatus: string | null,
    nextStatus: string,
    source: 'api' | 'dashboard' | 'provider' | 'provider_webhook' | 'reconciliation' | 'system',
    provider: string | null,
    providerResourceId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    const eventType = webhookEventType(resourceType, previousStatus)
    const { data: endpoints, error: endpointError } = await this.admin
      .from('tenant_webhook_endpoints')
      .select('id,subscribed_events')
      .eq('tenant_id', this.context.tenant.id)
      .eq('status', 'active')
    if (endpointError) {
      if (endpointError.code === '42P01') return
      console.error('[platform-api] webhook endpoint lookup failed', {
        resourceType,
        resourceId,
        requestId: this.context.requestId,
        error: endpointError,
      })
      return
    }

    const matchingEndpoints = (endpoints ?? []).filter((endpoint: Record<string, unknown>) =>
      matchesWebhookSubscription(endpoint.subscribed_events, eventType)
    )
    if (!matchingEndpoints.length) return

    const eventId = randomId('evt')
    const createdAt = new Date().toISOString()
    const payload = webhookEventPayload({
      id: eventId,
      type: eventType,
      createdAt,
      livemode: this.context.tenant.environment === 'production',
      tenantId: this.context.tenant.id,
      object: {
        resource_type: resourceType,
        resource_id: resourceId,
        previous_status: previousStatus,
        status: nextStatus,
        source,
        provider,
        provider_resource_id: providerResourceId,
        request_id: this.context.requestId,
        idempotency_key: this.context.idempotencyKey,
        details,
      },
    })

    const { error } = await this.admin.from('webhook_outbox').insert(
      matchingEndpoints.map((endpoint: Record<string, unknown>) => ({
        id: randomId('wo'),
        tenant_id: this.context.tenant.id,
        endpoint_id: endpoint.id,
        event_type: eventType,
        resource_id: resourceId,
        payload,
        status: 'pending',
        attempts: 0,
        next_attempt_at: createdAt,
      })),
    )
    if (error) {
      console.error('[platform-api] webhook enqueue failed', {
        resourceType,
        resourceId,
        eventType,
        requestId: this.context.requestId,
        error,
      })
    }
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

function publicCustomer(
  customer: any,
  wallet: PlatformCustomerWallet | null = null,
): Record<string, unknown> {
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
    provider_status_raw: customer.provider_status_raw ?? null,
    kyc_started_at: customer.kyc_started_at ?? null,
    kyc_active_at: customer.kyc_active_at ?? null,
    kyc_rejected_at: customer.kyc_rejected_at ?? null,
    last_provider_sync_at: customer.last_provider_sync_at ?? null,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
    metadata: customer.metadata ?? {},
    wallet: wallet ? publicCustomerWallet(wallet) : null,
  }
}

function publicCustomerWallet(wallet: PlatformCustomerWallet): Record<string, unknown> {
  return {
    id: wallet.id,
    customer_id: wallet.customer_id,
    provider: wallet.wallet_provider,
    provider_wallet_id: wallet.privy_wallet_id,
    chain: wallet.chain,
    address: wallet.wallet_address,
    custody_model: wallet.custody_model,
    status: wallet.status,
    assigned_at: wallet.assigned_at,
    exported_at: wallet.exported_at ?? null,
    created_at: wallet.created_at,
    updated_at: wallet.updated_at,
  }
}

function providerStatusRaw(raw: Record<string, unknown> | null | undefined, fallback: string): string {
  const status = raw?.status ?? raw?.state ?? raw?.kyc_status ?? fallback
  return String(status ?? fallback)
}

function kycTosStatus(result: { tosUrl: string | null; kycUrl: string | null; status: string }): 'not_required' | 'pending' | 'accepted' {
  if (!result.tosUrl) return 'not_required'
  if (result.kycUrl && result.kycUrl !== result.tosUrl) return 'accepted'
  if (result.status === 'active') return 'accepted'
  return 'pending'
}

function kycCustomerTimestampPatch(
  customer: PlatformCustomer,
  nextStatus: string,
  nowIso: string,
): Record<string, string> {
  const patch: Record<string, string> = {}
  if (!customer.kyc_started_at) patch.kyc_started_at = nowIso
  if (nextStatus === 'active' && !customer.kyc_active_at) patch.kyc_active_at = nowIso
  if (nextStatus === 'rejected' && !customer.kyc_rejected_at) patch.kyc_rejected_at = nowIso
  return patch
}

function ownershipSnapshot(input: {
  tenantId: string
  customer: PlatformCustomer
  quoteId: string
  transferId: string
  clientReferenceId: string
  providerCustomerId: string | null
}): Record<string, unknown> {
  return {
    tenant_id: input.tenantId,
    customer_id: input.customer.id,
    customer_external_id: input.customer.external_id,
    quote_id: input.quoteId,
    transfer_id: input.transferId,
    client_reference_id: input.clientReferenceId,
    provider_customer_id: input.providerCustomerId,
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function publicKycSession(session: any): Record<string, unknown> {
  return {
    id: session.id,
    customer_id: session.customer_id,
    provider: session.provider,
    status: session.status,
    tos_status: session.tos_status ?? 'pending',
    tos_url: session.tos_url,
    kyc_url: session.kyc_url,
    tos_url_issued_at: session.tos_url_issued_at ?? null,
    kyc_url_issued_at: session.kyc_url_issued_at ?? null,
    provider_status_raw: session.provider_status_raw ?? null,
    last_provider_sync_at: session.last_provider_sync_at ?? null,
    expires_at: session.expires_at,
    created_at: session.created_at,
  }
}

function publicVirtualAccount(account: any): Record<string, unknown> {
  return {
    id: account.id,
    customer_id: account.customer_id,
    status: account.status,
    provider_status_raw: account.provider_status_raw ?? null,
    last_provider_sync_at: account.last_provider_sync_at ?? null,
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
    processing_at: quote.processing_at ?? null,
    consumed_at: quote.consumed_at ?? null,
    expired_at: quote.expired_at ?? null,
    canceled_at: quote.canceled_at ?? null,
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
    provider_status_raw: transfer.provider_status_raw ?? null,
    last_provider_sync_at: transfer.last_provider_sync_at ?? null,
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
    reconciliation: {
      status: transfer.reconciliation_status ?? 'unreconciled',
      reconciled_at: transfer.reconciled_at ?? null,
      details: transfer.reconciliation_details ?? {},
    },
    settlement: {
      status: transfer.settlement_status ?? 'unsettled',
      batch_id: transfer.settlement_batch_id ?? null,
      item_id: transfer.settlement_item_id ?? null,
      settled_amount: String(transfer.settled_amount ?? 0),
      reserve_amount: String(transfer.settlement_reserved_amount ?? 0),
      settled_at: transfer.settled_at ?? null,
      details: transfer.settlement_details ?? {},
    },
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

function optionalFieldString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, field, { max })
}

function optionalObject(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  return requireObject(value, field)
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

function isAssignedWalletRoute(route: Record<string, unknown>): boolean {
  return route.currency === 'usdc' && route.payment_rail === 'solana'
}

function withAssignedCustomerWallet(
  route: Record<string, unknown>,
  input: Record<string, unknown>,
  wallet: PlatformCustomerWallet,
  field: string,
): Record<string, unknown> {
  const requestedAddress = optionalFieldString(input.address, `${field}.address`, 256)
  if (requestedAddress && requestedAddress !== wallet.wallet_address) {
    throw new ApiError(
      409,
      'assigned_wallet_mismatch',
      `${field}.address must match the assigned customer wallet`,
    )
  }
  return {
    ...route,
    address: wallet.wallet_address,
    customer_wallet_id: wallet.id,
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
