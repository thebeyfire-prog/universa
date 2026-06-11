import { DynamicBondingCurveClient, getTokenProgram } from '@meteora-ag/dynamic-bonding-curve-sdk'
import {
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
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
const DEFAULT_LAUNCH_RECORD_PATH = path.join(SCRIPT_DIR, '.last-dbc-launch.json')
const DEFAULT_OUTPUT_PATH = path.join(SCRIPT_DIR, '.last-vault-fund.json')
const DEFAULT_VAULT_PROGRAM_ID = '8uQrLVdn8geKdBPVJmoNWUyosN7xoQKxzjdWYpvrAZ3H'
const DEFAULT_REWARDS_AMOUNT = '5000000'
const DEFAULT_DECIMALS = 6

function usage() {
  console.error(`usage:
  npm run fund-vault -- [options]
  npm run fund-vault -- --execute --yes [options]

purpose:
  After a Meteora DBC pool migrates and the reserved UNV allocation unlocks,
  withdraw the leftover base tokens and transfer the developer rewards
  allocation immediately into the Anchor rewards vault token account.

options:
  --execute                  send transaction; default is dry-run/simulate only
  --yes                      required with --execute
  --watch                    poll until the pool is migrated and leftover can be withdrawn
  --interval-ms <ms>         watch polling interval; default 15000
  --max-attempts <n>         watch attempt cap; default 0 means unlimited
  --wallet <path>            leftover receiver signer; defaults to .secrets/sol-wallets/wallet-1.json
  --rpc <url>                Solana RPC; defaults to SOL_RPC_URL or mainnet-beta
  --launch-record <path>     DBC launch record; defaults to scripts/universa-token/.last-dbc-launch.json
  --pool <pubkey>            DBC pool address; defaults to launch record pool
  --mint <pubkey>            UNV mint; defaults to pool base mint or launch record baseMint
  --program-id <pubkey>      rewards vault program id; defaults to current generated id
  --vault-token-account <pk> override derived vault token account
  --amount <tokens>          UI token amount to fund; default ${DEFAULT_REWARDS_AMOUNT}
  --amount-raw <amount>      raw base units to fund; overrides --amount
  --skip-withdraw            only transfer from leftover receiver ATA to vault
  --output <path>            execution record path; defaults to .last-vault-fund.json`)
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

function arg(args, key, fallback = '') {
  return args[key] === undefined || args[key] === '' ? fallback : args[key]
}

function boolArg(args, key) {
  return args[key] === true || args[key] === 'true'
}

function intArg(args, key, fallback) {
  const value = Number(arg(args, key, String(fallback)))
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${key} must be a non-negative integer`)
  return value
}

function publicKey(value, label) {
  try {
    return new PublicKey(value)
  } catch (error) {
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

function readJsonFile(filepath, fallback = null) {
  if (!fs.existsSync(filepath)) return fallback
  return JSON.parse(fs.readFileSync(filepath, 'utf8'))
}

function decimalAmountToRaw(value, decimals) {
  const normalized = String(value).trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`Invalid token amount: ${value}`)
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) {
    throw new Error(`Token amount ${value} has more than ${decimals} decimal places`)
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

function rawToDecimal(raw, decimals) {
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
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

function retryable(message) {
  const error = new Error(message)
  error.retryable = true
  return error
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function buildAndMaybeSend(input) {
  const {
    args,
    connection,
    dbc,
    execute,
    launchRecord,
    outputPath,
    signer,
  } = input

  const pool = publicKey(arg(args, 'pool', launchRecord?.pool), '--pool')
  const poolAccount = await dbc.state.getPool(pool)
  if (!poolAccount) throw new Error(`DBC pool not found: ${pool.toBase58()}`)

  const poolState = poolAccount.poolState ?? poolAccount
  const configAddress = poolState.config
  const poolConfig = await dbc.state.getPoolConfig(configAddress)
  if (!poolConfig) throw new Error(`DBC pool config not found: ${configAddress.toBase58()}`)

  const mint = publicKey(arg(args, 'mint', poolState.baseMint?.toBase58?.() || launchRecord?.baseMint), '--mint')
  if (!poolState.baseMint.equals(mint)) {
    throw new Error(`--mint does not match pool base mint. Pool base mint is ${poolState.baseMint.toBase58()}`)
  }

  const mintAccount = await getMint(connection, mint)
  const decimals = Number(mintAccount.decimals ?? DEFAULT_DECIMALS)
  const amountRaw = arg(args, 'amount-raw')
    ? BigInt(arg(args, 'amount-raw'))
    : decimalAmountToRaw(arg(args, 'amount', String(launchRecord?.rewardsAllocation ?? DEFAULT_REWARDS_AMOUNT)), decimals)
  if (amountRaw <= 0n) throw new Error('Transfer amount must be greater than zero')

  const tokenBaseProgram = getTokenProgram(poolConfig.tokenType)
  if (!tokenBaseProgram.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`Unsupported base token program for rewards vault funding: ${tokenBaseProgram.toBase58()}`)
  }

  const leftoverReceiver = poolConfig.leftoverReceiver
  if (!leftoverReceiver.equals(signer.publicKey)) {
    throw new Error(
      `Signer must be the DBC leftover receiver. Expected ${leftoverReceiver.toBase58()}, got ${signer.publicKey.toBase58()}`,
    )
  }

  const programId = publicKey(arg(args, 'program-id', DEFAULT_VAULT_PROGRAM_ID), '--program-id')
  const derived = deriveVaultAccounts(programId, mint)
  const vault = arg(args, 'vault-token-account')
    ? publicKey(arg(args, 'vault-token-account'), '--vault-token-account')
    : derived.vault

  const vaultAccount = await getAccount(connection, vault, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null)
  if (!vaultAccount) {
    throw retryable(
      `Rewards vault token account does not exist yet: ${vault.toBase58()}. Initialize the Anchor vault before funding it.`,
    )
  }
  if (!vaultAccount.mint.equals(mint)) throw new Error(`Vault token account mint does not match UNV mint: ${vault.toBase58()}`)
  if (!vaultAccount.owner.equals(derived.vaultAuthority) && !arg(args, 'vault-token-account')) {
    throw new Error(`Derived vault token account has unexpected owner: ${vaultAccount.owner.toBase58()}`)
  }

  const sourceTokenAccount = getAssociatedTokenAddressSync(mint, leftoverReceiver, false, tokenBaseProgram)
  const poolMigrated = Number(poolState.isMigrated ?? 0) !== 0
  const leftoverAlreadyWithdrawn = Number(poolState.isWithdrawLeftover ?? 0) !== 0
  let skipWithdraw = boolArg(args, 'skip-withdraw') || leftoverAlreadyWithdrawn

  if (!skipWithdraw && !poolMigrated) {
    throw retryable(`DBC pool has not migrated yet. migrationProgress=${Number(poolState.migrationProgress ?? 0)}`)
  }

  if (skipWithdraw) {
    const sourceAccount = await getAccount(connection, sourceTokenAccount, 'confirmed', tokenBaseProgram).catch(() => null)
    if (!sourceAccount || sourceAccount.amount < amountRaw) {
      throw retryable(
        `Leftover receiver ATA does not have enough UNV yet. Needed ${amountRaw}, current ${sourceAccount?.amount ?? 0n}`,
      )
    }
  }

  const tx = new Transaction()
  if (!skipWithdraw) {
    const withdrawTx = await dbc.migration.withdrawLeftover({
      pool,
      payer: signer.publicKey,
    })
    tx.add(...withdrawTx.instructions)
  }
  tx.add(createTransferCheckedInstruction(
    sourceTokenAccount,
    mint,
    vault,
    signer.publicKey,
    amountRaw,
    decimals,
    [],
    tokenBaseProgram,
  ))

  tx.feePayer = signer.publicKey
  const latest = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  tx.sign(signer)

  const record = {
    dryRun: !execute,
    execute,
    pool: pool.toBase58(),
    dbcConfig: configAddress.toBase58(),
    mint: mint.toBase58(),
    decimals,
    amount: rawToDecimal(amountRaw, decimals),
    amountRaw: amountRaw.toString(),
    signer: signer.publicKey.toBase58(),
    leftoverReceiver: leftoverReceiver.toBase58(),
    sourceTokenAccount: sourceTokenAccount.toBase58(),
    rewardsVaultProgram: programId.toBase58(),
    rewardsVaultConfig: derived.config.toBase58(),
    rewardsVaultAuthority: derived.vaultAuthority.toBase58(),
    rewardsVaultTokenAccount: vault.toBase58(),
    poolMigrated,
    leftoverAlreadyWithdrawn,
    skipWithdraw,
    instructionCount: tx.instructions.length,
    createdAt: new Date().toISOString(),
  }

  const simulation = await connection.simulateTransaction(tx)
  record.simulation = {
    err: simulation.value.err ?? null,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logs: simulation.value.logs?.slice(-25) ?? [],
  }

  if (simulation.value.err) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    throw retryable(`Funding transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
  }

  if (!execute) {
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    console.log('')
    console.log('Dry run ok. No transaction sent.')
    printRecord(record)
    console.log(`Saved dry-run record: ${outputPath}`)
    console.log('Send with: npm run fund-vault -- --execute --yes')
    return record
  }

  const signature = await sendAndConfirmTransaction(connection, tx, [signer], {
    commitment: 'confirmed',
    skipPreflight: false,
    maxRetries: 3,
  })
  record.dryRun = false
  record.signature = signature
  record.tx = `https://solscan.io/tx/${signature}`
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  console.log('')
  console.log('Funding transaction sent.')
  printRecord(record)
  console.log(`Transaction: ${record.tx}`)
  console.log(`Saved execution record: ${outputPath}`)
  return record
}

function printRecord(record) {
  console.log(`Pool: ${record.pool}`)
  console.log(`Mint: ${record.mint}`)
  console.log(`Amount: ${record.amount} UNV (${record.amountRaw} raw)`)
  console.log(`Leftover receiver ATA: ${record.sourceTokenAccount}`)
  console.log(`Rewards vault token account: ${record.rewardsVaultTokenAccount}`)
  console.log(`Instructions: ${record.instructionCount} (${record.skipWithdraw ? 'transfer only' : 'withdraw leftover + transfer'})`)
  console.log(`Simulation units: ${record.simulation.unitsConsumed ?? 'unknown'}`)
}

async function main() {
  loadEnvFile(DEFAULT_ENV_PATH)
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const execute = boolArg(args, 'execute')
  if (execute && !boolArg(args, 'yes')) throw new Error('Refusing to send transactions without --yes')

  const walletPath = path.resolve(process.cwd(), arg(args, 'wallet', DEFAULT_WALLET_PATH))
  const signer = loadKeypairFromFile(walletPath)
  const rpc = arg(args, 'rpc', process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com')
  const connection = new Connection(rpc, 'confirmed')
  const dbc = new DynamicBondingCurveClient(connection, 'confirmed')
  const launchRecordPath = path.resolve(process.cwd(), arg(args, 'launch-record', DEFAULT_LAUNCH_RECORD_PATH))
  const launchRecord = readJsonFile(launchRecordPath, {})
  const outputPath = path.resolve(process.cwd(), arg(args, 'output', DEFAULT_OUTPUT_PATH))
  const watch = boolArg(args, 'watch')
  const intervalMs = intArg(args, 'interval-ms', 15_000)
  const maxAttempts = intArg(args, 'max-attempts', 0)

  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      if (watch) console.log(`[${new Date().toISOString()}] funding attempt ${attempt}`)
      await buildAndMaybeSend({ args, connection, dbc, execute, launchRecord, outputPath, signer })
      return
    } catch (error) {
      if (!watch || !error.retryable) throw error
      console.log(`[${new Date().toISOString()}] not ready: ${error.message}`)
      if (maxAttempts > 0 && attempt >= maxAttempts) {
        throw new Error(`Reached --max-attempts=${maxAttempts} before funding succeeded`)
      }
      await sleep(intervalMs)
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
