import fs from 'node:fs'
import path from 'node:path'
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'out')

const plan = buildPlan()
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'universa-dbc-plan.json')
fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`)

console.log(`Wrote ${outPath}`)
console.log(`public_float_supply=${plan.token.publicFloatSupply}`)
console.log(`initial_price_usdc=${plan.economics.initialPriceQuote}`)
console.log(`flat_price_cost_for_50pct_public_float_usdc=${plan.economics.flatPriceCostFor50PercentOfPublicFloat}`)
console.log(`curve_warning=${plan.economics.curveImpactWarning}`)

function buildPlan() {
  const totalSupply = numberEnv('UNIVERSA_DBC_TOTAL_SUPPLY', 10_000_000)
  const publicFloatSupply = numberEnv('UNIVERSA_DBC_PUBLIC_FLOAT_SUPPLY', 4_500_000)
  const initialMarketCap = numberEnv('UNIVERSA_DBC_INITIAL_MARKET_CAP', 5_000)
  const migrationMarketCap = numberEnv('UNIVERSA_DBC_MIGRATION_MARKET_CAP', 100_000)
  const firstBuyQuoteAmount = numberEnv('UNIVERSA_DBC_FIRST_BUY_QUOTE_AMOUNT', 500)
  const tokenDecimals = integerEnv('UNIVERSA_DBC_TOKEN_DECIMALS', 6)
  const quoteDecimals = integerEnv('UNIVERSA_DBC_QUOTE_DECIMALS', 6)
  const startingFeeBps = integerEnv('UNIVERSA_DBC_STARTING_FEE_BPS', 100)
  const endingFeeBps = integerEnv('UNIVERSA_DBC_ENDING_FEE_BPS', 25)
  const feePeriods = integerEnv('UNIVERSA_DBC_FEE_PERIODS', 12)
  const feeDurationSeconds = integerEnv('UNIVERSA_DBC_FEE_DURATION_SECONDS', 7 * 24 * 60 * 60)
  const poolCreationFee = numberEnv('UNIVERSA_DBC_POOL_CREATION_FEE_QUOTE', 0.001)

  if (initialMarketCap <= 0) throw new Error('UNIVERSA_DBC_INITIAL_MARKET_CAP must be positive')
  if (totalSupply <= 0) throw new Error('UNIVERSA_DBC_TOTAL_SUPPLY must be positive')
  if (publicFloatSupply <= 0) throw new Error('UNIVERSA_DBC_PUBLIC_FLOAT_SUPPLY must be positive')
  if (publicFloatSupply > totalSupply) {
    throw new Error('UNIVERSA_DBC_PUBLIC_FLOAT_SUPPLY cannot exceed UNIVERSA_DBC_TOTAL_SUPPLY')
  }
  if (migrationMarketCap <= initialMarketCap) {
    throw new Error('UNIVERSA_DBC_MIGRATION_MARKET_CAP must be greater than initial market cap')
  }
  if (endingFeeBps < 25) {
    throw new Error('Meteora DBC rejects pre-graduation base fees below 25 bps')
  }

  const params = {
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: tokenDecimalEnum(tokenDecimals),
      tokenQuoteDecimal: tokenDecimalEnum(quoteDecimals),
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: totalSupply,
      leftover: totalSupply - publicFloatSupply,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps,
          endingFeeBps,
          numberOfPeriod: feePeriods,
          totalDuration: feeDurationSeconds,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap,
    migrationMarketCap,
  }

  const config = buildCurveWithMarketCap(params)
  const reservedSupply = totalSupply - publicFloatSupply
  const initialPrice = initialMarketCap / totalSupply
  const flatPriceTokens = firstBuyQuoteAmount / initialPrice

  return {
    mode: 'dry-run',
    warning: [
      'This file is a launch plan, not a signed transaction.',
      'Review the generated DBC config, wallet keys, metadata URI, and Meteora terms before signing.',
      'DBC mints the full token supply. Developer rewards and team allocations are reserved with token.leftover and sent to the leftoverReceiver after migration.',
      'The SDK dependency tree currently has Solana package audit findings with no upstream fix available.',
    ],
    quote: {
      symbol: env('UNIVERSA_DBC_QUOTE_SYMBOL', 'USDC'),
      decimals: quoteDecimals,
      mint: env('UNIVERSA_DBC_QUOTE_MINT', 'USDC_MAINNET_MINT_REQUIRED_BEFORE_EXECUTION'),
    },
    token: {
      name: env('UNIVERSA_DBC_TOKEN_NAME', 'Universa'),
      symbol: env('UNIVERSA_DBC_TOKEN_SYMBOL', 'UNV'),
      uri: env('UNIVERSA_DBC_TOKEN_URI', 'METADATA_URI_REQUIRED_BEFORE_EXECUTION'),
      decimals: tokenDecimals,
      totalSupply,
      publicFloatSupply,
      reservedSupply,
    },
    allocation: {
      developerRewardsPercentOfTotal: 50,
      teamPercentOfTotal: 5,
      publicFloatPercentOfTotal: fixed(publicFloatSupply / totalSupply * 100, 4),
      marketingPercentOfTotal: 0,
    },
    economics: {
      initialMarketCapQuote: initialMarketCap,
      migrationMarketCapQuote: migrationMarketCap,
      initialPriceQuote: fixed(initialPrice, 12),
      firstBuyQuoteAmount,
      flatPriceTokensForFirstBuy: fixed(flatPriceTokens, 6),
      flatPricePublicFloatPercentForFirstBuy: fixed(flatPriceTokens / publicFloatSupply * 100, 4),
      flatPriceTotalSupplyPercentForFirstBuy: fixed(flatPriceTokens / totalSupply * 100, 4),
      flatPriceCostFor50PercentOfPublicFloat: fixed(initialPrice * publicFloatSupply / 2, 6),
      flatPriceCostFor50PercentOfTotalSupply: fixed(initialMarketCap / 2, 6),
      curveImpactWarning:
        'The 50% public-float cost is only true at a fixed initial price. DBC is a bonding curve, so a large acquisition of public float moves price and should cost more than this before fees/slippage.',
    },
    params,
    dbcConfig: normalize(config),
  }
}

function tokenDecimalEnum(value) {
  const allowed = new Map([
    [6, TokenDecimal.SIX],
    [7, TokenDecimal.SEVEN],
    [8, TokenDecimal.EIGHT],
    [9, TokenDecimal.NINE],
  ])
  const tokenDecimal = allowed.get(value)
  if (tokenDecimal === undefined) throw new Error(`DBC token decimals must be 6, 7, 8, or 9. Got ${value}`)
  return tokenDecimal
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    if (value.constructor?.name === 'BN') return value.toString()
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]))
  }
  return value
}

function numberEnv(name, fallback) {
  const value = env(name, String(fallback))
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`)
  return parsed
}

function integerEnv(name, fallback) {
  const parsed = numberEnv(name, fallback)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`)
  return parsed
}

function env(name, fallback) {
  return process.env[name] || fallback
}

function fixed(value, decimals) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, '')
}
