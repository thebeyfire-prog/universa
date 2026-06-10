import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  validateConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { NATIVE_MINT } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.resolve(SCRIPT_DIR, '../..')
const DEFAULT_ENV_PATH = path.join(REPO_DIR, '.secrets/pump.env')
const DEFAULT_WALLET_PATH = path.join(REPO_DIR, '.secrets/sol-wallets/wallet-1.json')
const DEFAULT_IMAGE_PATH = path.join(SCRIPT_DIR, 'assets/universa-oil-hands.png')
const DEFAULT_OUTPUT_PATH = path.join(SCRIPT_DIR, '.last-dbc-launch.json')
const TEMP_PLACEHOLDER_METADATA_URI = 'https://ipfs.io/ipfs/bafkreigw6iv37yuxmgl6v7vevnfla4ldtzjdq2szwpitnq3itsshns4oei'
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const DEFAULTS = {
  name: 'Universa',
  symbol: 'UNV',
  description:
    'Universa is building compliance-ready stablecoin rails for fiat on-ramp, off-ramp, virtual accounts, KYC, and developer rewards.',
  website: 'https://universa-brm.pages.dev',
  twitter: 'https://x.com/UniversaRails',
  totalSupply: 10_000_000,
  publicFloatAllocation: 4_500_000,
  rewardsAllocation: 5_000_000,
  teamAllocation: 500_000,
  initialMarketCap: 5_000,
  migrationMarketCap: 100_000,
  startingFeeBps: 100,
  endingFeeBps: 100,
  migratedPoolFeeBps: 100,
  quote: 'USDC',
}

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return
  const lines = fs.readFileSync(filepath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    if (!raw.startsWith('--')) {
      args._.push(raw)
      continue
    }
    const eq = raw.indexOf('=')
    if (eq !== -1) {
      args[raw.slice(2, eq)] = raw.slice(eq + 1)
      continue
    }
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function usage() {
  console.error(`usage:
  npm run dry-run -- [options]
  npm run launch -- --yes [options]

options:
  --execute                  send mainnet transactions; default is dry-run/simulate only
  --wallet <path>             signer keypair path; defaults to .secrets/sol-wallets/wallet-1.json
  --rpc <url>                 Solana RPC; defaults to SOL_RPC_URL or mainnet-beta
  --metadata-uri <url>        existing token metadata JSON URI; skips Pinata upload
  --image <path>              image to pin if metadata-uri is not provided
  --quote USDC|SOL            quote mint; defaults to USDC
  --initial-mcap <usd>        initial FDV/market cap for DBC curve; default 10000
  --migration-mcap <usd>      migration FDV/market cap; default 100000
  --yes                       required with --execute to prevent accidental mainnet sends`)
}

function arg(args, key, fallback) {
  return args[key] === undefined || args[key] === '' ? fallback : args[key]
}

function num(args, key, fallback) {
  const value = Number(arg(args, key, fallback))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number`)
  return value
}

function quoteMintFor(value) {
  const normalized = String(value || DEFAULTS.quote).toUpperCase()
  if (normalized === 'USDC') return { label: 'USDC', mint: USDC_MINT, decimals: TokenDecimal.SIX }
  if (normalized === 'SOL') return { label: 'SOL', mint: NATIVE_MINT, decimals: TokenDecimal.NINE }
  throw new Error('--quote must be USDC or SOL')
}

function loadKeypairFromFile(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed))
  if (Array.isArray(parsed?.secretKey)) return Keypair.fromSecretKey(Uint8Array.from(parsed.secretKey))
  return Keypair.fromSecretKey(bs58.decode(raw))
}

function mimeFor(filepath) {
  const ext = path.extname(filepath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.svg') return 'image/svg+xml'
  return 'image/png'
}

async function uploadPinataFile({ filepath, auth, filename, mime }) {
  const body = new FormData()
  body.append('file', new Blob([fs.readFileSync(filepath)], { type: mime }), filename)
  body.append('network', 'public')

  const res = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.jwt}` },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Pinata upload ${res.status}: ${text}`)
  const json = JSON.parse(text)
  const cid = json?.data?.cid || json?.IpfsHash
  if (!cid) throw new Error(`Pinata upload returned no cid: ${text}`)
  return `https://ipfs.io/ipfs/${cid}`
}

async function buildMetadataUri(args, token) {
  const existing = arg(args, 'metadata-uri', '')
  if (existing) return { metadataUri: existing, imageUri: null }

  const jwt = process.env.PINATA_JWT
  if (!jwt) throw new Error('Missing PINATA_JWT. Pass --metadata-uri or set PINATA_JWT in .secrets/pump.env.')

  const imagePath = path.resolve(process.cwd(), arg(args, 'image', DEFAULT_IMAGE_PATH))
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`)

  const imageUri = await uploadPinataFile({
    filepath: imagePath,
    auth: { jwt },
    filename: path.basename(imagePath),
    mime: mimeFor(imagePath),
  })

  const metadata = {
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    image: imageUri,
    external_url: token.website,
    extensions: {
      website: token.website,
      twitter: token.twitter,
    },
  }
  const tmpMetadataPath = path.join(SCRIPT_DIR, `.metadata-${Date.now()}.json`)
  fs.writeFileSync(tmpMetadataPath, JSON.stringify(metadata, null, 2))
  try {
    const metadataUri = await uploadPinataFile({
      filepath: tmpMetadataPath,
      auth: { jwt },
      filename: `${token.symbol.toLowerCase()}-metadata.json`,
      mime: 'application/json',
    })
    return { metadataUri, imageUri }
  } finally {
    try {
      fs.unlinkSync(tmpMetadataPath)
    } catch {
      // Best-effort temp cleanup.
    }
  }
}

function buildCurveConfig({ quote, initialMarketCap, migrationMarketCap }) {
  const baseParams = {
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quote.decimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: DEFAULTS.totalSupply,
      leftover: DEFAULTS.totalSupply - DEFAULTS.publicFloatAllocation,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: DEFAULTS.startingFeeBps,
          endingFeeBps: DEFAULTS.endingFeeBps,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: DEFAULTS.migratedPoolFeeBps,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
  }

  const config = buildCurveWithMarketCap({
    ...baseParams,
    initialMarketCap,
    migrationMarketCap,
  })
  return config
}

async function prepare() {
  loadEnvFile(DEFAULT_ENV_PATH)
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }

  const execute = Boolean(args.execute)
  if (execute && !args.yes) throw new Error('Refusing to send mainnet transactions without --yes')
  if (execute) {
    const metadataUriArg = arg(args, 'metadata-uri', '')
    const usingPlaceholderMetadata = metadataUriArg === TEMP_PLACEHOLDER_METADATA_URI
    if (usingPlaceholderMetadata) {
      throw new Error(
        'Refusing to launch with the temporary Universa wordmark metadata. Pass the final metadata URI or let the script pin the default oil-hands image.',
      )
    }
  }

  const walletPath = path.resolve(process.cwd(), arg(args, 'wallet', DEFAULT_WALLET_PATH))
  const signer = loadKeypairFromFile(walletPath)
  const rpc = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpc, 'confirmed')
  const quote = quoteMintFor(arg(args, 'quote', DEFAULTS.quote))
  const initialMarketCap = num(args, 'initial-mcap', DEFAULTS.initialMarketCap)
  const migrationMarketCap = num(args, 'migration-mcap', DEFAULTS.migrationMarketCap)
  if (migrationMarketCap <= initialMarketCap) {
    throw new Error('--migration-mcap must be greater than --initial-mcap')
  }

  const token = {
    name: arg(args, 'name', DEFAULTS.name),
    symbol: arg(args, 'symbol', DEFAULTS.symbol),
    description: arg(args, 'description', DEFAULTS.description),
    website: arg(args, 'website', DEFAULTS.website),
    twitter: arg(args, 'twitter', DEFAULTS.twitter),
  }

  const configKeypair = Keypair.generate()
  const baseMint = Keypair.generate()
  const dbc = new DynamicBondingCurveClient(connection, 'confirmed')
  const curveConfig = buildCurveConfig({ quote, initialMarketCap, migrationMarketCap })
  validateConfigParameters({ ...curveConfig, leftoverReceiver: signer.publicKey })
  const pool = deriveDbcPoolAddress(quote.mint, baseMint.publicKey, configKeypair.publicKey)

  const { metadataUri, imageUri } = await buildMetadataUri(args, token)
  const tx = await dbc.partner.createConfigAndPool({
    config: configKeypair.publicKey,
    feeClaimer: signer.publicKey,
    leftoverReceiver: signer.publicKey,
    payer: signer.publicKey,
    quoteMint: quote.mint,
    ...curveConfig,
    preCreatePoolParam: {
      baseMint: baseMint.publicKey,
      name: token.name,
      symbol: token.symbol,
      uri: metadataUri,
      poolCreator: signer.publicKey,
    },
  })
  tx.feePayer = signer.publicKey

  const latest = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  tx.sign(signer, configKeypair, baseMint)

  const record = {
    dryRun: !execute,
    name: token.name,
    symbol: token.symbol,
    totalSupply: DEFAULTS.totalSupply,
    publicFloatAllocation: DEFAULTS.publicFloatAllocation,
    reservedAllocation: DEFAULTS.totalSupply - DEFAULTS.publicFloatAllocation,
    rewardsAllocation: DEFAULTS.rewardsAllocation,
    teamAllocation: DEFAULTS.teamAllocation,
    quote: quote.label,
    quoteMint: quote.mint.toBase58(),
    initialMarketCap,
    migrationMarketCap,
    deployer: signer.publicKey.toBase58(),
    config: configKeypair.publicKey.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    pool: pool.toBase58(),
    metadataUri,
    imageUri,
    migrationQuoteThresholdRaw: curveConfig.migrationQuoteThreshold.toString(),
    preMigrationTokenSupplyRaw: curveConfig.tokenSupply?.preMigrationTokenSupply?.toString() ?? null,
    postMigrationTokenSupplyRaw: curveConfig.tokenSupply?.postMigrationTokenSupply?.toString() ?? null,
    createdAt: new Date().toISOString(),
  }

  console.log('')
  console.log(`${execute ? 'Launching' : 'Dry run'} ${record.name} (${record.symbol}) on Meteora DBC`)
  console.log(`Deployer: ${record.deployer}`)
  console.log(`Quote: ${record.quote} (${record.quoteMint})`)
  console.log(`Mint: ${record.baseMint}`)
  console.log(`Pool: ${record.pool}`)
  console.log(`Config: ${record.config}`)
  console.log(`Metadata: ${record.metadataUri}`)
  console.log(`Initial mcap: $${initialMarketCap.toLocaleString('en-US')} | Migration mcap: $${migrationMarketCap.toLocaleString('en-US')}`)
  console.log(`Migration quote threshold raw: ${record.migrationQuoteThresholdRaw}`)

  const simulation = await connection.simulateTransaction(tx)
  record.simulation = {
    err: simulation.value.err ?? null,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logs: simulation.value.logs?.slice(-20) ?? [],
  }
  if (simulation.value.err) {
    console.log('')
    console.log('Simulation failed:')
    console.log(JSON.stringify(record.simulation, null, 2))
    fs.writeFileSync(DEFAULT_OUTPUT_PATH, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    process.exitCode = 1
    return
  }

  console.log(`Simulation ok. Units: ${simulation.value.unitsConsumed ?? 'unknown'}`)

  if (!execute) {
    fs.writeFileSync(DEFAULT_OUTPUT_PATH, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    console.log(`Saved dry-run record: ${DEFAULT_OUTPUT_PATH}`)
    console.log('No transaction sent. Re-run with: npm run launch -- --yes')
    return
  }

  const signature = await sendAndConfirmTransaction(connection, tx, [signer, configKeypair, baseMint], {
    commitment: 'confirmed',
    skipPreflight: false,
    maxRetries: 3,
  })
  record.dryRun = false
  record.signature = signature
  record.tx = `https://solscan.io/tx/${signature}`
  record.mintUrl = `https://solscan.io/token/${record.baseMint}`
  fs.writeFileSync(DEFAULT_OUTPUT_PATH, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  console.log(`Launch tx: ${record.tx}`)
  console.log(`Mint: ${record.mintUrl}`)
  console.log(`Saved launch record: ${DEFAULT_OUTPUT_PATH}`)
}

prepare().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
