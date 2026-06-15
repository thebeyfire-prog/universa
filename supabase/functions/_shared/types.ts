export type Tenant = {
  id: string
  name: string
  status: 'sandbox' | 'active' | 'suspended' | 'closed'
  environment: 'sandbox' | 'production'
  kyb_status: 'not_submitted' | 'pending' | 'approved' | 'rejected'
  risk_tier: 'sandbox' | 'standard' | 'enhanced' | 'blocked'
}

export type ApiKeyRecord = {
  id: string
  tenant_id: string
  key_hash: string
  secret_ciphertext: string
  scopes: string[]
  status: 'active' | 'disabled' | 'revoked'
  ip_allowlist: string[]
  expires_at: string | null
  tenants: Tenant
}

export type RequestContext = {
  requestId: string
  tenant: Tenant
  apiKey: ApiKeyRecord
  method: string
  path: string
  rawBody: string
  idempotencyKey: string | null
  ip: string
  userAgent: string
}

export type ProviderName = 'mock' | 'partner'

export type PlatformCustomer = {
  id: string
  tenant_id: string
  external_id: string
  type: 'individual' | 'business'
  full_name: string
  email: string
  country_code: string
  status: string
  provider: ProviderName | null
  provider_customer_id: string | null
  provider_kyc_status: string | null
  provider_status_raw: string | null
  last_provider_sync_at: string | null
  kyc_started_at: string | null
  kyc_active_at: string | null
  kyc_rejected_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PlatformCustomerWallet = {
  id: string
  tenant_id: string
  customer_id: string
  wallet_provider: 'privy'
  privy_app_id: string
  privy_wallet_id: string
  wallet_address: string
  chain: 'solana'
  custody_model: 'privy_server_wallet'
  status: 'active' | 'held' | 'revoked'
  assigned_at: string
  exported_at: string | null
  provider_payload: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ProviderKycSession = {
  providerCustomerId: string
  providerSessionId: string | null
  status: string
  tosUrl: string | null
  kycUrl: string | null
  expiresAt: string | null
  raw: Record<string, unknown>
}

export type ProviderVirtualAccount = {
  id: string
  status: string
  sourceCurrency: string
  sourceRail: string | null
  depositInstructions: Record<string, unknown>
  raw: Record<string, unknown>
}

export type ProviderTransfer = {
  id: string
  status: string
  sourceDepositInstructions: Record<string, unknown> | null
  raw: Record<string, unknown>
}
