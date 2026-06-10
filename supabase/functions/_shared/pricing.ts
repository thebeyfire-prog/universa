import { ApiError } from './errors.ts'

const SCALE = 100n

export type PricingBreakdown = {
  grossAmount: string
  providerFee: string
  universaFee: string
  tenantFee: string
  platformFee: string
  networkFee: string
  destinationAmount: string
  feeCurrency: string
  pricingVersion: string
  universaFeeBps: number
  tenantFeeBps: number
  providerFeeBps: number
}

export function calculatePricing(
  amount: string,
  currency: string,
  tenantFeeBps = envInteger('DEFAULT_TENANT_FEE_BPS', 0),
): PricingBreakdown {
  const gross = parseMoney(amount)
  const providerFeeBps = envInteger('ESTIMATED_PROVIDER_FEE_BPS', 75)
  const universaFeeBps = envInteger('UNIVERSA_FEE_BPS', 30)
  const providerFee = feeFromBps(gross, providerFeeBps)
  const universaFee = feeFromBps(gross, universaFeeBps)
  const tenantFee = feeFromBps(gross, tenantFeeBps)
  const platformFee = universaFee + tenantFee
  const networkFee = parseMoney(
    Deno.env.get('ESTIMATED_NETWORK_FEE') ?? '0.00',
    { allowZero: true },
  )
  const destination = gross - providerFee - platformFee - networkFee

  if (destination <= 0n) {
    throw new ApiError(400, 'amount_below_minimum', 'Amount is too small after fees')
  }

  return {
    grossAmount: formatMoney(gross),
    providerFee: formatMoney(providerFee),
    universaFee: formatMoney(universaFee),
    tenantFee: formatMoney(tenantFee),
    platformFee: formatMoney(platformFee),
    networkFee: formatMoney(networkFee),
    destinationAmount: formatMoney(destination),
    feeCurrency: currency.toLowerCase(),
    pricingVersion: [
      'v1',
      `partner-${providerFeeBps}`,
      `universa-${universaFeeBps}`,
      `tenant-${tenantFeeBps}`,
    ].join(':'),
    universaFeeBps,
    tenantFeeBps,
    providerFeeBps,
  }
}

export function quoteExpiry(): string {
  const ttl = Math.min(3600, Math.max(30, envInteger('QUOTE_TTL_SECONDS', 300)))
  return new Date(Date.now() + ttl * 1000).toISOString()
}

function parseMoney(
  value: string,
  options: { allowZero?: boolean } = {},
): bigint {
  if (!/^\d{1,18}(\.\d{1,2})?$/.test(value)) {
    throw new ApiError(
      400,
      'invalid_amount',
      'amount must be a positive decimal string with at most 2 decimal places',
    )
  }
  const [whole, fraction = ''] = value.split('.')
  const minor = BigInt(whole) * SCALE + BigInt(fraction.padEnd(2, '0'))
  if (minor < 0n || (!options.allowZero && minor === 0n)) {
    throw new ApiError(400, 'invalid_amount', 'amount must be greater than zero')
  }
  return minor
}

function feeFromBps(amount: bigint, bps: number): bigint {
  if (bps <= 0) return 0n
  return (amount * BigInt(bps) + 9999n) / 10000n
}

function formatMoney(value: bigint): string {
  const whole = value / SCALE
  const fraction = String(value % SCALE).padStart(2, '0')
  return `${whole}.${fraction}`
}

function envInteger(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name) ?? fallback)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
