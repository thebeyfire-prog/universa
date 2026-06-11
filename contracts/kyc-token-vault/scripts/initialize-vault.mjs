import * as anchor from '@coral-xyz/anchor'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import idl from '../target/idl/kyc_token_vault.json' with { type: 'json' }

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT_DIR = path.resolve(SCRIPT_DIR, '..')
const DEFAULT_OUTPUT_PATH = path.join(CONTRACT_DIR, '.last-vault-init.json')
const DEFAULT_PROGRAM_ID = '8uQrLVdn8geKdBPVJmoNWUyosN7xoQKxzjdWYpvrAZ3H'
const DEFAULT_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const DEFAULT_MAX_TOTAL_REWARDS_RAW = '5000000000000'

function usage() {
  console.error(`usage:
  npm run initialize:vault -- [options]
  npm run initialize:vault -- --execute --yes [options]

options:
  --execute                    send transaction; default is dry-run/simulate only
  --yes                        required with --execute
  --wallet <path>              admin/payer keypair
  --rpc <url>                  Solana RPC; defaults to SOL_RPC_URL or mainnet-beta
  --mint <pubkey>              UNV mint; defaults to current UNV mint
  --program-id <pubkey>        vault program id
  --rewards-authority <pubkey> signer allowed to create epochs and release rewards; defaults to payer
  --max-total-rewards-raw <n>  raw max rewards cap; default ${DEFAULT_MAX_TOTAL_REWARDS_RAW}
  --output <path>              record path; defaults to .last-vault-init.json`)
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

function arg(args, key, fallback = '') {
  return args[key] === undefined || args[key] === '' ? fallback : args[key]
}

function boolArg(args, key) {
  return args[key] === true || args[key] === 'true'
}

function publicKey(value, label) {
  try {
    return new PublicKey(value)
  } catch {
    throw new Error(`${label} is not a valid Solana public key: ${value}`)
  }
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

function deriveVaultAccounts(programId, mint) {
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from('config'), mint.toBuffer()],
    programId,
  )
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), config.toBuffer()],
    programId,
  )
  const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true, TOKEN_PROGRAM_ID)
  return { config, vaultAuthority, vault }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const execute = boolArg(args, 'execute')
  if (execute && !boolArg(args, 'yes')) throw new Error('Refusing to send transactions without --yes')

  const walletPath = arg(args, 'wallet')
  if (!walletPath) throw new Error('Pass --wallet <path> for the admin/payer keypair')

  const payer = loadKeypairFromFile(path.resolve(process.cwd(), walletPath))
  const rpc = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpc, 'confirmed')
  const wallet = new anchor.Wallet(payer)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const programId = publicKey(arg(args, 'program-id', DEFAULT_PROGRAM_ID), '--program-id')
  const program = new anchor.Program({ ...idl, address: programId.toBase58() }, provider)
  const mint = publicKey(arg(args, 'mint', DEFAULT_MINT), '--mint')
  const rewardsAuthority = publicKey(
    arg(args, 'rewards-authority', payer.publicKey.toBase58()),
    '--rewards-authority',
  )
  const maxTotalRewardsRaw = new anchor.BN(arg(args, 'max-total-rewards-raw', DEFAULT_MAX_TOTAL_REWARDS_RAW))
  const outputPath = path.resolve(process.cwd(), arg(args, 'output', DEFAULT_OUTPUT_PATH))
  const { config, vaultAuthority, vault } = deriveVaultAccounts(programId, mint)

  const existingConfig = await connection.getAccountInfo(config, 'confirmed')
  const existingVault = await getAccount(connection, vault, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null)
  const record = {
    dryRun: !execute,
    execute,
    programId: programId.toBase58(),
    mint: mint.toBase58(),
    admin: payer.publicKey.toBase58(),
    rewardsAuthority: rewardsAuthority.toBase58(),
    maxTotalRewardsRaw: maxTotalRewardsRaw.toString(),
    config: config.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
    vault: vault.toBase58(),
    existingConfig: Boolean(existingConfig),
    existingVault: Boolean(existingVault),
    createdAt: new Date().toISOString(),
  }

  if (existingConfig || existingVault) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    console.log('Vault appears already initialized or partially initialized.')
    console.log(JSON.stringify(record, null, 2))
    return
  }

  const tx = await program.methods
    .initialize(maxTotalRewardsRaw)
    .accountsStrict({
      admin: payer.publicKey,
      rewardsAuthority,
      mint,
      config,
      vaultAuthority,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction()

  tx.feePayer = payer.publicKey
  const latest = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  tx.sign(payer)

  const simulation = await connection.simulateTransaction(tx)
  record.simulation = {
    err: simulation.value.err ?? null,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logs: simulation.value.logs?.slice(-25) ?? [],
  }

  if (simulation.value.err) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    throw new Error(`Initialize simulation failed: ${JSON.stringify(simulation.value.err)}`)
  }

  if (!execute) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    console.log('Dry run ok. No transaction sent.')
    console.log(JSON.stringify(record, null, 2))
    console.log('Send with --execute --yes')
    return
  }

  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
    skipPreflight: false,
    maxRetries: 3,
  })
  record.dryRun = false
  record.signature = signature
  record.tx = `https://solscan.io/tx/${signature}`
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })

  console.log('Vault initialized.')
  console.log(JSON.stringify(record, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
