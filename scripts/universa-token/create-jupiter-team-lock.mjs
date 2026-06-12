import * as anchor from '@coral-xyz/anchor'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token'
import bs58 from 'bs58'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.resolve(SCRIPT_DIR, '../..')
const DEFAULT_ENV_PATH = path.join(REPO_DIR, '.secrets/pump.env')
const DEFAULT_WALLET_PATH = path.join(REPO_DIR, '.secrets/sol-wallets/wallet-1.json')
const MONET_WALLET_PATH = '/Users/exodia/Monet-btc/.secrets/sol-wallets/wallet-1.json'
const DEFAULT_BASE_KEYPAIR_PATH = path.join(REPO_DIR, '.secrets/sol-wallets/unv-team-lock-base.json')
const DEFAULT_OUTPUT_PATH = path.join(SCRIPT_DIR, '.last-team-lock.json')

const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const TEAM_RECIPIENT = '3MRMNHnDpLctCHJVfL3d9qHrkXTPFJeTUWVod11krpTj'
const JUPITER_LOCK_PROGRAM_ID = 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn'
const DEFAULT_AMOUNT = '500000'
const DEFAULT_CLIFF_DAYS = 183
const DEFAULT_PERIOD_DAYS = 30
const DEFAULT_PERIODS = 20
const SECONDS_PER_DAY = 86400

function usage() {
  console.error(`usage:
  npm run team-lock
  npm run team-lock -- --execute --yes

purpose:
  Create a Jupiter Lock vesting escrow for the remaining UNV team allocation.
  The default is immutable and non-cancellable: 500,000 UNV, 183 day cliff,
  then 20 monthly unlocks of 25,000 UNV.

options:
  --execute                  send transaction; default is dry-run/simulate only
  --yes                      required with --execute
  --wallet <path>            token holder signer; defaults to .secrets/sol-wallets/wallet-1.json
  --base-keypair <path>      generated escrow base signer; defaults to .secrets/sol-wallets/unv-team-lock-base.json
  --rpc <url>                Solana RPC; defaults to SOL_RPC_URL or mainnet-beta
  --mint <pubkey>            token mint; defaults to UNV
  --recipient <pubkey>       vesting recipient; defaults to admin/team wallet
  --program-id <pubkey>      Jupiter Lock program id; defaults to mainnet id
  --amount <tokens>          UI token amount to lock; default ${DEFAULT_AMOUNT}
  --amount-raw <amount>      raw base units to lock; overrides --amount
  --start-time <unix>        vesting start timestamp; default current unix time
  --cliff-days <days>        cliff length from start; default ${DEFAULT_CLIFF_DAYS}
  --period-days <days>       unlock frequency; default ${DEFAULT_PERIOD_DAYS}
  --periods <n>              unlock periods; default ${DEFAULT_PERIODS}
  --update-recipient-mode <n> 0 disables recipient updates; default 0
  --cancel-mode <n>          0 disables cancellation; default 0
  --output <path>            execution record path; defaults to .last-team-lock.json`)
}

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return
  for (const line of fs.readFileSync(filepath, 'utf8').split(/\r?\n/)) {
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
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
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
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function arg(args, key, fallback) {
  return args[key] === undefined || args[key] === '' ? fallback : args[key]
}

function defaultWalletPath() {
  if (fs.existsSync(DEFAULT_WALLET_PATH)) return DEFAULT_WALLET_PATH
  if (fs.existsSync(MONET_WALLET_PATH)) return MONET_WALLET_PATH
  return DEFAULT_WALLET_PATH
}

function loadKeypairFromFile(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw))
  }
  if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed))
  if (typeof parsed.secretKey === 'string') return Keypair.fromSecretKey(bs58.decode(parsed.secretKey))
  if (Array.isArray(parsed.secretKey)) return Keypair.fromSecretKey(Uint8Array.from(parsed.secretKey))
  throw new Error(`Unsupported keypair file format: ${filepath}`)
}

function saveKeypairToFile(filepath, keypair) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true })
  fs.writeFileSync(filepath, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, { mode: 0o600 })
}

function loadOrCreateKeypair(filepath) {
  if (fs.existsSync(filepath)) return loadKeypairFromFile(filepath)
  const keypair = Keypair.generate()
  saveKeypairToFile(filepath, keypair)
  return keypair
}

function parseBool(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes'
}

function parseInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function parseUiAmount(value, decimals) {
  const text = String(value).trim().replaceAll(',', '')
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid token amount: ${value}`)
  const [whole, frac = ''] = text.split('.')
  if (frac.length > decimals) throw new Error(`Too many decimal places for mint decimals ${decimals}: ${value}`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals))
}

function formatUiAmount(raw, decimals) {
  const negative = raw < 0n
  const value = negative ? -raw : raw
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`
}

function toBn(value, name) {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error(`${name} does not fit in u64`)
  return new anchor.BN(value.toString())
}

function iso(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString()
}

function buildProviderWallet(publicKey) {
  return {
    publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (parseBool(args.help)) {
    usage()
    return
  }

  loadEnvFile(DEFAULT_ENV_PATH)

  const execute = parseBool(args.execute)
  const yes = parseBool(args.yes)
  if (execute && !yes) throw new Error('--yes is required with --execute')

  const walletPath = path.resolve(arg(args, 'wallet', defaultWalletPath()))
  const baseKeypairPath = path.resolve(arg(args, 'base-keypair', DEFAULT_BASE_KEYPAIR_PATH))
  const outputPath = path.resolve(arg(args, 'output', DEFAULT_OUTPUT_PATH))
  const rpcUrl = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpcUrl, 'confirmed')

  const wallet = loadKeypairFromFile(walletPath)
  const mint = new PublicKey(arg(args, 'mint', UNV_MINT))
  const recipient = new PublicKey(arg(args, 'recipient', TEAM_RECIPIENT))
  const programId = new PublicKey(arg(args, 'program-id', JUPITER_LOCK_PROGRAM_ID))
  const startTime = parseInteger(arg(args, 'start-time', Math.floor(Date.now() / 1000)), '--start-time')
  const cliffDays = parseInteger(arg(args, 'cliff-days', DEFAULT_CLIFF_DAYS), '--cliff-days')
  const periodDays = parseInteger(arg(args, 'period-days', DEFAULT_PERIOD_DAYS), '--period-days')
  const periods = parseInteger(arg(args, 'periods', DEFAULT_PERIODS), '--periods')
  const updateRecipientMode = parseInteger(arg(args, 'update-recipient-mode', 0), '--update-recipient-mode')
  const cancelMode = parseInteger(arg(args, 'cancel-mode', 0), '--cancel-mode')
  if (periods <= 0) throw new Error('--periods must be greater than zero')
  if (periodDays <= 0) throw new Error('--period-days must be greater than zero')
  if (updateRecipientMode > 3) throw new Error('--update-recipient-mode must be 0, 1, 2, or 3')
  if (cancelMode > 3) throw new Error('--cancel-mode must be 0, 1, 2, or 3')

  const mintInfo = await getMint(connection, mint)
  const decimals = mintInfo.decimals
  const amountRaw = args['amount-raw'] === undefined
    ? parseUiAmount(arg(args, 'amount', DEFAULT_AMOUNT), decimals)
    : BigInt(String(args['amount-raw']).replaceAll(',', ''))
  if (amountRaw <= 0n) throw new Error('amount must be greater than zero')

  const amountPerPeriod = amountRaw / BigInt(periods)
  const cliffUnlockAmount = amountRaw % BigInt(periods)
  const totalDeposit = cliffUnlockAmount + amountPerPeriod * BigInt(periods)
  if (totalDeposit !== amountRaw) throw new Error('internal amount math mismatch')

  const cliffTime = startTime + cliffDays * SECONDS_PER_DAY
  const frequency = periodDays * SECONDS_PER_DAY
  const endTime = cliffTime + frequency * periods

  const senderToken = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const senderAccount = await getAccount(connection, senderToken, 'confirmed', TOKEN_PROGRAM_ID)
  if (senderAccount.amount < amountRaw) {
    throw new Error(`Signer token account has ${formatUiAmount(senderAccount.amount, decimals)} UNV, needs ${formatUiAmount(amountRaw, decimals)} UNV`)
  }

  const base = loadOrCreateKeypair(baseKeypairPath)
  const [escrow] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), base.publicKey.toBuffer()], programId)
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], programId)

  const provider = new anchor.AnchorProvider(connection, buildProviderWallet(wallet.publicKey), { commitment: 'confirmed' })
  const idl = await anchor.Program.fetchIdl(programId, provider)
  if (!idl) throw new Error(`No on-chain Anchor IDL found for Jupiter Lock program ${programId.toBase58()}`)
  const program = new anchor.Program(idl, provider)

  const params = {
    vestingStartTime: toBn(BigInt(startTime), 'vestingStartTime'),
    cliffTime: toBn(BigInt(cliffTime), 'cliffTime'),
    frequency: toBn(BigInt(frequency), 'frequency'),
    cliffUnlockAmount: toBn(cliffUnlockAmount, 'cliffUnlockAmount'),
    amountPerPeriod: toBn(amountPerPeriod, 'amountPerPeriod'),
    numberOfPeriod: toBn(BigInt(periods), 'numberOfPeriod'),
    updateRecipientMode,
    cancelMode,
  }

  const createEscrowTokenIx = createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    escrowToken,
    escrow,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  const createLockIx = await program.methods
    .createVestingEscrow(params)
    .accounts({
      base: base.publicKey,
      escrow,
      escrowToken,
      sender: wallet.publicKey,
      senderToken,
      recipient,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority,
      program: programId,
    })
    .instruction()

  const tx = new Transaction().add(createEscrowTokenIx, createLockIx)
  tx.feePayer = wallet.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  tx.sign(wallet, base)

  const simulation = await connection.simulateTransaction(tx)
  const record = {
    mode: execute ? 'execute' : 'dry-run',
    programId: programId.toBase58(),
    mint: mint.toBase58(),
    sender: wallet.publicKey.toBase58(),
    senderToken: senderToken.toBase58(),
    recipient: recipient.toBase58(),
    baseKeypairPath,
    base: base.publicKey.toBase58(),
    escrow: escrow.toBase58(),
    escrowToken: escrowToken.toBase58(),
    amountRaw: amountRaw.toString(),
    amountUi: formatUiAmount(amountRaw, decimals),
    cliffUnlockAmountRaw: cliffUnlockAmount.toString(),
    cliffUnlockAmountUi: formatUiAmount(cliffUnlockAmount, decimals),
    amountPerPeriodRaw: amountPerPeriod.toString(),
    amountPerPeriodUi: formatUiAmount(amountPerPeriod, decimals),
    numberOfPeriod: periods,
    vestingStartTime: startTime,
    cliffTime,
    frequency,
    endTime,
    vestingStartIso: iso(startTime),
    cliffIso: iso(cliffTime),
    endIso: iso(endTime),
    cliffDays,
    periodDays,
    updateRecipientMode,
    cancelMode,
    simulationError: simulation.value.err,
    simulationLogs: simulation.value.logs,
  }

  if (simulation.value.err) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`)
    throw new Error(`Simulation failed; wrote ${outputPath}`)
  }

  if (execute) {
    const signature = await sendAndConfirmTransaction(connection, tx, [wallet, base], {
      commitment: 'confirmed',
      maxRetries: 5,
    })
    record.signature = signature
    record.solscan = `https://solscan.io/tx/${signature}`
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`)
  console.log(JSON.stringify(record, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
