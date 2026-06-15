import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  createDammV2Program,
  deriveDammV2EventAuthority,
  deriveDammV2PoolAuthority,
  derivePositionNftAccount,
  DAMM_V2_PROGRAM_ID,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import bs58 from 'bs58'
import fs from 'node:fs'

const DEFAULT_WALLET_PATH = '/Users/exodia/Monet-btc/.secrets/sol-wallets/wallet-1.json'
const DEFAULT_DAMM_POOL = 'GrxcFmnJgS57vjQRz9BcdFWkBNBqDsv78pvZa98AH3hm'
const DEFAULT_POSITION = '6pwvevTEAJzDDvPpMsNcVrz8NHvEemvTtqZERLM8Yg7H'
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const Q128_SHIFT = 128n

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
  node claim-damm-fees-transfer-usdc.mjs --destination <solana-wallet> --amount-usdc 400
  node claim-damm-fees-transfer-usdc.mjs --destination <solana-wallet> --amount-usdc 400 --execute --yes

options:
  --wallet <path>         signer wallet; defaults to Monet-btc wallet-1
  --rpc <url>             Solana RPC; defaults to SOL_RPC_URL or public mainnet
  --pool <address>        DAMM v2 pool; defaults to Universa migrated pool
  --position <address>    DAMM v2 position; defaults to Universa locked position
  --destination <address> recipient Solana wallet owner address
  --amount-usdc <amount>  decimal USDC amount, e.g. 400 or 400.000000
  --amount-raw <amount>   raw USDC amount; alternative to --amount-usdc
  --execute               broadcast the atomic claim + transfer transaction
  --yes                   required with --execute
  --allow-off-curve-destination  allow PDA/off-curve recipient owners`)
}

function arg(args, key, fallback) {
  return args[key] === undefined || args[key] === '' ? fallback : args[key]
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

function parseUsdcAmount(args) {
  if (args['amount-raw'] !== undefined) return BigInt(String(args['amount-raw']))
  const raw = args['amount-usdc']
  if (raw === undefined || raw === '') throw new Error('Missing --amount-usdc or --amount-raw')

  const value = String(raw).trim()
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error(`Invalid USDC amount ${value}; use up to 6 decimal places`)
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

function formatToken(raw, decimals, symbol) {
  const n = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const frac = String(n % base).padStart(decimals, '0')
  return `${whole}.${frac} ${symbol}`
}

function bnToBigInt(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  if (value?.toString) return BigInt(value.toString())
  throw new Error(`Cannot convert value to BigInt: ${value}`)
}

function leBytesToBigInt(bytes) {
  if (!Array.isArray(bytes)) throw new Error('Expected fixed-point byte array')
  return bytes.reduce((sum, byte, index) => sum + (BigInt(byte) << BigInt(index * 8)), 0n)
}

function positiveDelta(next, previous) {
  return next > previous ? next - previous : 0n
}

function positionLiquidity(position) {
  return (
    bnToBigInt(position.unlockedLiquidity) +
    bnToBigInt(position.vestedLiquidity) +
    bnToBigInt(position.permanentLockedLiquidity)
  )
}

function claimableFees(pool, position) {
  const liquidity = positionLiquidity(position)
  const feeAGrowthDelta = positiveDelta(
    leBytesToBigInt(pool.feeAPerLiquidity),
    leBytesToBigInt(position.feeAPerTokenCheckpoint),
  )
  const feeBGrowthDelta = positiveDelta(
    leBytesToBigInt(pool.feeBPerLiquidity),
    leBytesToBigInt(position.feeBPerTokenCheckpoint),
  )

  return {
    feeA: bnToBigInt(position.feeAPending) + ((liquidity * feeAGrowthDelta) >> Q128_SHIFT),
    feeB: bnToBigInt(position.feeBPending) + ((liquidity * feeBGrowthDelta) >> Q128_SHIFT),
    liquidity,
  }
}

async function getTokenProgram(connection, mint) {
  const account = await connection.getAccountInfo(mint, 'confirmed')
  if (!account) throw new Error(`Mint not found: ${mint.toBase58()}`)
  return account.owner
}

async function getRawTokenBalance(connection, tokenAccount) {
  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed')
    return BigInt(balance.value.amount)
  } catch (error) {
    const message = String(error?.message ?? error)
    if (message.includes('could not find account') || message.includes('Invalid param')) return 0n
    throw error
  }
}

async function buildTransaction({
  connection,
  signer,
  poolAddress,
  positionAddress,
  destination,
  transferRaw,
}) {
  const program = createDammV2Program(connection, 'confirmed')
  const [pool, position] = await Promise.all([
    program.account.pool.fetch(poolAddress),
    program.account.position.fetch(positionAddress),
  ])

  if (!pool.tokenAMint.equals(USDC_MINT) && !pool.tokenBMint.equals(USDC_MINT)) {
    throw new Error(`Pool does not contain USDC mint ${USDC_MINT.toBase58()}`)
  }
  if (!position.pool.equals(poolAddress)) {
    throw new Error(`Position ${positionAddress.toBase58()} belongs to ${position.pool.toBase58()}, not ${poolAddress.toBase58()}`)
  }

  const [tokenAProgram, tokenBProgram] = await Promise.all([
    getTokenProgram(connection, pool.tokenAMint),
    getTokenProgram(connection, pool.tokenBMint),
  ])
  const [mintA, mintB] = await Promise.all([
    getMint(connection, pool.tokenAMint, 'confirmed', tokenAProgram),
    getMint(connection, pool.tokenBMint, 'confirmed', tokenBProgram),
  ])

  const signerTokenAAccount = getAssociatedTokenAddressSync(
    pool.tokenAMint,
    signer.publicKey,
    false,
    tokenAProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  const signerTokenBAccount = getAssociatedTokenAddressSync(
    pool.tokenBMint,
    signer.publicKey,
    false,
    tokenBProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  const usdcSide = pool.tokenAMint.equals(USDC_MINT) ? 'A' : 'B'
  const usdcProgram = usdcSide === 'A' ? tokenAProgram : tokenBProgram
  const signerUsdcAccount = usdcSide === 'A' ? signerTokenAAccount : signerTokenBAccount
  const recipientUsdcAccount = getAssociatedTokenAddressSync(
    USDC_MINT,
    destination,
    true,
    usdcProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  const claimInstruction = await program.methods.claimPositionFee().accountsPartial({
    poolAuthority: deriveDammV2PoolAuthority(),
    pool: poolAddress,
    position: positionAddress,
    tokenAAccount: signerTokenAAccount,
    tokenBAccount: signerTokenBAccount,
    tokenAVault: pool.tokenAVault,
    tokenBVault: pool.tokenBVault,
    tokenAMint: pool.tokenAMint,
    tokenBMint: pool.tokenBMint,
    positionNftAccount: derivePositionNftAccount(position.nftMint),
    owner: signer.publicKey,
    tokenAProgram,
    tokenBProgram,
    eventAuthority: deriveDammV2EventAuthority(),
    program: DAMM_V2_PROGRAM_ID,
  }).instruction()

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      signerTokenAAccount,
      signer.publicKey,
      pool.tokenAMint,
      tokenAProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      signerTokenBAccount,
      signer.publicKey,
      pool.tokenBMint,
      tokenBProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    claimInstruction,
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      recipientUsdcAccount,
      destination,
      USDC_MINT,
      usdcProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      signerUsdcAccount,
      USDC_MINT,
      recipientUsdcAccount,
      signer.publicKey,
      transferRaw,
      6,
      [],
      usdcProgram,
    ),
  )

  const latest = await connection.getLatestBlockhash('confirmed')
  tx.feePayer = signer.publicKey
  tx.recentBlockhash = latest.blockhash
  tx.sign(signer)

  return {
    tx,
    latest,
    pool,
    position,
    tokenAProgram,
    tokenBProgram,
    mintA,
    mintB,
    signerTokenAAccount,
    signerTokenBAccount,
    signerUsdcAccount,
    recipientUsdcAccount,
    usdcSide,
    estimatedClaimable: claimableFees(pool, position),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const execute = Boolean(args.execute)
  if (execute && !args.yes) throw new Error('Refusing to broadcast without --yes')

  const destination = args.destination ? new PublicKey(String(args.destination)) : null
  if (!destination) throw new Error('Missing --destination')
  if (!args['allow-off-curve-destination'] && !PublicKey.isOnCurve(destination.toBuffer())) {
    throw new Error(`Destination ${destination.toBase58()} is off-curve; pass --allow-off-curve-destination if this is intentional`)
  }

  const transferRaw = parseUsdcAmount(args)
  if (transferRaw <= 0n) throw new Error('Transfer amount must be positive')

  const walletPath = arg(args, 'wallet', DEFAULT_WALLET_PATH)
  const signer = loadKeypairFromFile(walletPath)
  const rpc = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpc, 'confirmed')
  const poolAddress = new PublicKey(arg(args, 'pool', DEFAULT_DAMM_POOL))
  const positionAddress = new PublicKey(arg(args, 'position', DEFAULT_POSITION))

  const built = await buildTransaction({
    connection,
    signer,
    poolAddress,
    positionAddress,
    destination,
    transferRaw,
  })

  const claimableUsdc = built.usdcSide === 'A'
    ? built.estimatedClaimable.feeA
    : built.estimatedClaimable.feeB
  const signerUsdcBefore = await getRawTokenBalance(connection, built.signerUsdcAccount)
  const projectedSignerUsdc = signerUsdcBefore + claimableUsdc

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Signer: ${signer.publicKey.toBase58()}`)
  console.log(`DAMM v2 pool: ${poolAddress.toBase58()}`)
  console.log(`Position: ${positionAddress.toBase58()}`)
  console.log(`Destination owner: ${destination.toBase58()}`)
  console.log(`Destination USDC ATA: ${built.recipientUsdcAccount.toBase58()}`)
  console.log(`Token A: ${built.pool.tokenAMint.toBase58()} decimals=${built.mintA.decimals}`)
  console.log(`Token B: ${built.pool.tokenBMint.toBase58()} decimals=${built.mintB.decimals}`)
  console.log(`Claimable estimate: A=${formatToken(built.estimatedClaimable.feeA, built.mintA.decimals, 'token A')} B=${formatToken(built.estimatedClaimable.feeB, built.mintB.decimals, 'token B')}`)
  console.log(`Signer USDC before: ${formatToken(signerUsdcBefore, 6, 'USDC')}`)
  console.log(`Projected signer USDC after claim: ${formatToken(projectedSignerUsdc, 6, 'USDC')}`)
  console.log(`Transfer: ${formatToken(transferRaw, 6, 'USDC')}`)

  if (projectedSignerUsdc < transferRaw) {
    throw new Error(`Insufficient projected USDC: ${formatToken(projectedSignerUsdc, 6, 'USDC')} < ${formatToken(transferRaw, 6, 'USDC')}`)
  }

  const sim = await connection.simulateTransaction(built.tx)
  console.log(`Simulation: err=${JSON.stringify(sim.value.err)} units=${sim.value.unitsConsumed ?? 'unknown'}`)
  if (sim.value.err) {
    console.log(JSON.stringify(sim.value.logs?.slice(-20) ?? [], null, 2))
    throw new Error('Simulation failed; not broadcasting')
  }

  if (!execute) {
    console.log('Dry run only. Re-run with --execute --yes after confirming the destination and amount.')
    return
  }

  const signature = await connection.sendRawTransaction(built.tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  })
  await connection.confirmTransaction({
    signature,
    blockhash: built.latest.blockhash,
    lastValidBlockHeight: built.latest.lastValidBlockHeight,
  }, 'confirmed')
  console.log(`Transaction: https://solscan.io/tx/${signature}`)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
