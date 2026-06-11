import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  DynamicBondingCurveClient,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import bs58 from 'bs58'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.resolve(SCRIPT_DIR, '../..')
const DEFAULT_RECORD_PATH = path.join(SCRIPT_DIR, '.last-dbc-launch.json')
const DEFAULT_WALLET_PATH = '/Users/exodia/Monet-btc/.secrets/sol-wallets/wallet-1.json'
const RELAY_QUOTE_URL = 'https://api.relay.link/quote'
const SOL_CHAIN_ID = 792703809
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const NATIVE_SOL = '11111111111111111111111111111111'
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

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
  node claim-and-swap-fees-relay.mjs
  node claim-and-swap-fees-relay.mjs --execute-claim --yes
  node claim-and-swap-fees-relay.mjs --execute-swap --yes
  node claim-and-swap-fees-relay.mjs --execute-claim --execute-swap --yes

options:
  --wallet <path>        signer wallet; defaults to Monet-btc wallet-1
  --rpc <url>            Solana RPC; defaults to SOL_RPC_URL or public mainnet
  --record <path>        DBC launch record path
  --swap-amount <raw>    USDC raw amount to swap; defaults to post-claim USDC balance
  --keep-usdc <raw>      raw USDC to keep before swapping; default 0
  --execute-claim        send partner + creator fee claim transactions
  --execute-swap         send Relay USDC -> SOL transaction
  --yes                  required with either execute flag`)
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

function bn(value) {
  if (BN.isBN(value)) return value
  if (typeof value === 'string') return new BN(value, 10)
  return new BN(String(value))
}

function formatUsdc(raw) {
  const n = BigInt(raw.toString())
  const whole = n / 1_000_000n
  const frac = String(n % 1_000_000n).padStart(6, '0')
  return `${whole}.${frac} USDC`
}

function formatSol(lamports) {
  const n = BigInt(lamports.toString())
  const whole = n / 1_000_000_000n
  const frac = String(n % 1_000_000_000n).padStart(9, '0')
  return `${whole}.${frac} SOL`
}

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function getUsdcBalance(connection, owner) {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(USDC_MINT),
  })
  let raw = 0n
  for (const account of accounts.value) {
    const amount = account.account.data.parsed?.info?.tokenAmount?.amount
    if (typeof amount === 'string') raw += BigInt(amount)
  }
  return raw
}

async function buildRelayTransaction(connection, payer, quote) {
  const signatures = []
  for (const step of quote.steps ?? []) {
    for (let itemIndex = 0; itemIndex < (step.items ?? []).length; itemIndex += 1) {
      const item = step.items[itemIndex]
      const data = item?.data
      if (!Array.isArray(data?.instructions)) {
        throw new Error(`Relay step ${step.id ?? 'unknown'} item ${itemIndex} has no Solana instructions`)
      }

      const instructions = data.instructions.map((ix) => new TransactionInstruction({
        keys: ix.keys.map((key) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: Boolean(key.isSigner),
          isWritable: Boolean(key.isWritable),
        })),
        programId: new PublicKey(ix.programId),
        data: hexToBytes(ix.data),
      }))

      const lookupTables = []
      for (const address of data.addressLookupTableAddresses ?? []) {
        const lookup = await connection.getAddressLookupTable(new PublicKey(address))
        if (lookup.value) lookupTables.push(lookup.value)
      }

      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(lookupTables)

      signatures.push({
        stepId: step.id ?? 'unknown',
        itemIndex,
        tx: new VersionedTransaction(message),
        instructionCount: instructions.length,
        lookupCount: lookupTables.length,
      })
    }
  }
  return signatures
}

async function getRelayQuote({ user, amount }) {
  const res = await fetch(RELAY_QUOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user,
      recipient: user,
      originChainId: SOL_CHAIN_ID,
      destinationChainId: SOL_CHAIN_ID,
      originCurrency: USDC_MINT,
      destinationCurrency: NATIVE_SOL,
      amount: amount.toString(),
      tradeType: 'EXACT_INPUT',
      slippageTolerance: '50',
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Relay quote ${res.status}: ${JSON.stringify(data)}`)
  }
  return data
}

async function simulateVersioned(connection, tx, signer) {
  tx.sign([signer])
  return connection.simulateTransaction(tx)
}

async function sendVersioned(connection, tx, signer) {
  tx.sign([signer])
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  })
  await connection.confirmTransaction(signature, 'confirmed')
  return signature
}

async function buildClaimTxs({ connection, signer, pool }) {
  const dbc = new DynamicBondingCurveClient(connection, 'confirmed')
  const breakdown = await dbc.state.getPoolFeeBreakdown(pool)
  const claims = [
    {
      label: 'partner',
      maxBaseAmount: bn(breakdown.partner.unclaimedBaseFee),
      maxQuoteAmount: bn(breakdown.partner.unclaimedQuoteFee),
      build: () => dbc.partner.claimPartnerTradingFee({
        feeClaimer: signer.publicKey,
        payer: signer.publicKey,
        pool,
        maxBaseAmount: bn(breakdown.partner.unclaimedBaseFee),
        maxQuoteAmount: bn(breakdown.partner.unclaimedQuoteFee),
      }),
    },
    {
      label: 'creator',
      maxBaseAmount: bn(breakdown.creator.unclaimedBaseFee),
      maxQuoteAmount: bn(breakdown.creator.unclaimedQuoteFee),
      build: () => dbc.creator.claimCreatorTradingFee({
        creator: signer.publicKey,
        payer: signer.publicKey,
        pool,
        maxBaseAmount: bn(breakdown.creator.unclaimedBaseFee),
        maxQuoteAmount: bn(breakdown.creator.unclaimedQuoteFee),
      }),
    },
  ]

  const txs = []
  for (const claim of claims) {
    if (claim.maxBaseAmount.isZero() && claim.maxQuoteAmount.isZero()) {
      txs.push({ ...claim, skipped: true, reason: 'zero unclaimed fee' })
      continue
    }
    const tx = await claim.build()
    tx.feePayer = signer.publicKey
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
    txs.push({ ...claim, tx })
  }
  return txs
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const executeClaim = Boolean(args['execute-claim'])
  const executeSwap = Boolean(args['execute-swap'])
  if ((executeClaim || executeSwap) && !args.yes) {
    throw new Error('Refusing to send transactions without --yes')
  }

  const walletPath = path.resolve(process.cwd(), arg(args, 'wallet', DEFAULT_WALLET_PATH))
  const signer = loadKeypairFromFile(walletPath)
  const rpc = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpc, 'confirmed')
  const recordPath = path.resolve(process.cwd(), arg(args, 'record', DEFAULT_RECORD_PATH))
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  const pool = new PublicKey(record.pool)

  console.log(`Signer: ${signer.publicKey.toBase58()}`)
  console.log(`Pool: ${pool.toBase58()}`)
  console.log(`Mode: claim=${executeClaim ? 'execute' : 'simulate'} swap=${executeSwap ? 'execute' : 'preview'}`)

  const solBefore = await connection.getBalance(signer.publicKey)
  const usdcBefore = await getUsdcBalance(connection, signer.publicKey)
  console.log(`Starting balances: ${formatSol(solBefore)} | ${formatUsdc(usdcBefore)}`)

  const claimTxs = await buildClaimTxs({ connection, signer, pool })
  let projectedClaimedUsdc = 0n
  for (const claim of claimTxs) {
    if (claim.skipped) {
      console.log(`Claim ${claim.label}: skipped (${claim.reason})`)
      continue
    }
    projectedClaimedUsdc += BigInt(claim.maxQuoteAmount.toString(10))
    console.log(`Claim ${claim.label}: max quote ${formatUsdc(claim.maxQuoteAmount)} max base raw ${claim.maxBaseAmount.toString(10)}`)
    const sim = await connection.simulateTransaction(claim.tx, [signer])
    console.log(`Claim ${claim.label} simulation: err=${JSON.stringify(sim.value.err)} units=${sim.value.unitsConsumed ?? 'unknown'}`)
    if (sim.value.err) {
      console.log(JSON.stringify(sim.value.logs?.slice(-12) ?? [], null, 2))
      throw new Error(`Claim ${claim.label} simulation failed`)
    }
    if (executeClaim) {
      const signature = await sendAndConfirmTransaction(connection, claim.tx, [signer], {
        commitment: 'confirmed',
        skipPreflight: false,
        maxRetries: 5,
      })
      console.log(`Claim ${claim.label} tx: https://solscan.io/tx/${signature}`)
    }
  }

  const usdcAfterClaim = await getUsdcBalance(connection, signer.publicKey)
  const projectedUsdcAfterClaim = executeClaim ? usdcAfterClaim : usdcBefore + projectedClaimedUsdc
  const keepUsdc = BigInt(arg(args, 'keep-usdc', '0'))
  let swapAmount = args['swap-amount'] !== undefined
    ? BigInt(String(args['swap-amount']))
    : projectedUsdcAfterClaim > keepUsdc ? projectedUsdcAfterClaim - keepUsdc : 0n

  if (swapAmount <= 0n) {
    console.log(`Relay swap: skipped; post-claim balance ${formatUsdc(projectedUsdcAfterClaim)} keep ${formatUsdc(keepUsdc)}`)
    return
  }
  if (executeSwap && swapAmount > usdcAfterClaim) {
    throw new Error(`Swap amount ${swapAmount} exceeds USDC balance ${usdcAfterClaim}`)
  }

  const quote = await getRelayQuote({ user: signer.publicKey.toBase58(), amount: swapAmount })
  const outAmount = BigInt(quote.details?.currencyOut?.amount ?? '0')
  const minOut = BigInt(quote.details?.currencyOut?.minimumAmount ?? '0')
  console.log(`Relay quote: ${formatUsdc(swapAmount)} -> ${formatSol(outAmount)} minimum ${formatSol(minOut)} rate=${quote.details?.rate ?? 'unknown'}`)
  console.log(`Relay route: ${quote.details?.route?.origin?.router ?? 'unknown'} impact=${quote.details?.totalImpact?.percent ?? 'unknown'}%`)

  const relayTxs = await buildRelayTransaction(connection, signer.publicKey, quote)
  for (const item of relayTxs) {
    const sim = await simulateVersioned(connection, item.tx, signer)
    console.log(`Relay ${item.stepId}[${item.itemIndex}]: instructions=${item.instructionCount} lookups=${item.lookupCount} sim err=${JSON.stringify(sim.value.err)} units=${sim.value.unitsConsumed ?? 'unknown'}`)
    if (sim.value.err) {
      console.log(JSON.stringify(sim.value.logs?.slice(-12) ?? [], null, 2))
      throw new Error(`Relay ${item.stepId}[${item.itemIndex}] simulation failed`)
    }
    if (executeSwap) {
      const freshQuote = relayTxs.length === 1 ? null : null
      const signature = await sendVersioned(connection, item.tx, signer)
      console.log(`Relay ${item.stepId}[${item.itemIndex}] tx: https://solscan.io/tx/${signature}`)
      void freshQuote
    }
  }

  try {
    const solAfter = await connection.getBalance(signer.publicKey)
    const usdcAfter = await getUsdcBalance(connection, signer.publicKey)
    console.log(`Ending balances: ${formatSol(solAfter)} | ${formatUsdc(usdcAfter)}`)
  } catch (error) {
    console.log(`Ending balance refresh skipped: ${error?.message ?? String(error)}`)
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
