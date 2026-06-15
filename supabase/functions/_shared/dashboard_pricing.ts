import { ApiError } from './errors.ts'

const RATE_SCALE = 1_000_000n
const SOURCE_MINOR_SCALE = 100n

const DASHBOARD_FX_RATES: Record<string, string> = {
  'usd:mxn:spei': '17.2',
  'usdc:mxn:spei': '17.2',
  'usd:brl:pix': '5.32',
  'usdc:brl:pix': '5.32',
  'usd:cop:bank': '3925',
  'usdc:cop:bank': '3925',
  'usd:gbp:faster_payments': '0.78',
  'usdc:gbp:faster_payments': '0.78',
}

export type DashboardDestinationPricing = {
  amount: string
  rate: string
  pricingVersionSuffix: string
}

export function dashboardQuoteDestinationAmount(
  netSourceAmount: string,
  sourceCurrency: string,
  destinationCurrency: string,
  destinationRail: string,
): DashboardDestinationPricing {
  const rate = dashboardFxRate(sourceCurrency, destinationCurrency, destinationRail)
  const amount = applyDashboardFxRate(netSourceAmount, rate, destinationCurrency)
  return {
    amount,
    rate,
    pricingVersionSuffix: rate === '1'
      ? ''
      : `:fx-${sourceCurrency.toLowerCase()}-${destinationCurrency.toLowerCase()}-${rate}`,
  }
}

function dashboardFxRate(
  sourceCurrency: string,
  destinationCurrency: string,
  destinationRail: string,
): string {
  const source = sourceCurrency.toLowerCase()
  const destination = destinationCurrency.toLowerCase()
  const rail = destinationRail.toLowerCase()
  if (source === destination) return '1'
  return DASHBOARD_FX_RATES[`${source}:${destination}:${rail}`] ?? '1'
}

function applyDashboardFxRate(
  netSourceAmount: string,
  rate: string,
  destinationCurrency: string,
): string {
  const sourceMinor = parseSourceMinor(netSourceAmount)
  const rateScaled = parseRate(rate)
  const destinationScale = 10n ** BigInt(destinationCurrencyDecimals(destinationCurrency))
  const denominator = SOURCE_MINOR_SCALE * RATE_SCALE
  const raw = sourceMinor * rateScaled * destinationScale
  const rounded = (raw + denominator / 2n) / denominator
  return formatMinor(rounded, destinationCurrencyDecimals(destinationCurrency))
}

function parseSourceMinor(value: string): bigint {
  if (!/^\d{1,18}(\.\d{1,2})?$/.test(value)) {
    throw new ApiError(500, 'invalid_dashboard_pricing_amount', 'Dashboard pricing amount is invalid')
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * SOURCE_MINOR_SCALE + BigInt(fraction.padEnd(2, '0'))
}

function parseRate(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) {
    throw new ApiError(500, 'invalid_dashboard_fx_rate', 'Dashboard FX rate is invalid')
  }
  const [whole, fraction = ''] = value.split('.')
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, '0'))
  if (scaled <= 0n) {
    throw new ApiError(500, 'invalid_dashboard_fx_rate', 'Dashboard FX rate is invalid')
  }
  return scaled
}

function destinationCurrencyDecimals(currency: string): number {
  return currency.toUpperCase() === 'COP' ? 0 : 2
}

function formatMinor(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = String(value % scale).padStart(decimals, '0')
  return `${whole}.${fraction}`
}
