#!/usr/bin/env node
import { randomBytes } from 'node:crypto'

const args = parseArgs(process.argv.slice(2))

if (args.help || args.h) {
  printUsage()
  process.exit(0)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const provider = String(args.provider ?? 'bridge').toLowerCase()
const currency = String(args.currency ?? 'usd').toLowerCase()
const reserveBps = readInteger(args['reserve-bps'] ?? 0, 'reserve-bps')
const execute = Boolean(args.execute)
const tenantId = optionalString(args.tenant)
const periodStart = optionalString(args['period-start'])
const periodEnd = optionalString(args['period-end'])
const providerSettlementId = optionalString(args['provider-settlement-id'])
const note = optionalString(args.note)

if (reserveBps < 0 || reserveBps > 10_000) {
  throw new Error('--reserve-bps must be between 0 and 10000')
}

const obligations = await listOutstandingObligations()
const totalOutstanding = obligations.reduce((sum, row) => sum + moneyToMinor(row.amount_outstanding), 0n)
const receivedAmount = args.amount === undefined
  ? totalOutstanding
  : moneyToMinor(args.amount)

if (receivedAmount <= 0n) throw new Error('Settlement amount must be greater than zero')
if (!obligations.length) {
  console.log(`No outstanding ${provider}/${currency.toUpperCase()} settlement obligations found.`)
  process.exit(0)
}

const allocations = allocateSettlement(obligations, receivedAmount, reserveBps)
const allocatedAmount = allocations.reduce((sum, row) => sum + row.amountReceivedMinor, 0n)
const expectedAmount = allocations.reduce((sum, row) => sum + row.amountExpectedMinor, 0n)
const reserveAmount = allocations.reduce((sum, row) => sum + row.reserveMinor, 0n)
const overage = receivedAmount > allocatedAmount ? receivedAmount - allocatedAmount : 0n

printPlan({
  provider,
  currency,
  execute,
  receivedAmount,
  totalOutstanding,
  allocatedAmount,
  expectedAmount,
  reserveAmount,
  overage,
  allocations,
})

if (!execute) {
  console.log('\nDry run only. Add --execute to write the batch, item, ledger, and transfer settlement rows.')
  process.exit(0)
}

const batchId = randomId('setb')
const now = new Date().toISOString()
const batch = await insertOne('provider_settlement_batches', {
  id: batchId,
  provider,
  provider_settlement_id: providerSettlementId,
  status: allocatedAmount === expectedAmount && overage === 0n ? 'allocated' : 'partially_allocated',
  currency,
  amount_expected: minorToMoney(expectedAmount),
  amount_received: minorToMoney(receivedAmount),
  allocated_amount: minorToMoney(allocatedAmount),
  reserve_amount: minorToMoney(reserveAmount),
  settlement_period_start: periodStart,
  settlement_period_end: periodEnd,
  received_at: now,
  settled_at: now,
  metadata: {
    source: 'scripts/settlement-batch.mjs',
    note,
    dry_run: false,
    total_outstanding: minorToMoney(totalOutstanding),
    overage: minorToMoney(overage),
    reserve_bps: reserveBps,
  },
})

for (const allocation of allocations) {
  await writeAllocation(batch.id, allocation, now)
}

console.log(`\nWrote settlement batch ${batch.id} with ${allocations.length} item(s).`)

async function listOutstandingObligations() {
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('provider', `eq.${provider}`)
  params.set('currency', `eq.${currency}`)
  params.set('amount_outstanding', 'gt.0')
  params.set('order', 'created_at.asc')
  if (tenantId) params.set('tenant_id', `eq.${tenantId}`)
  if (periodStart) params.append('created_at', `gte.${periodStart}`)
  if (periodEnd) params.append('created_at', `lte.${periodEnd}`)
  return await rest(`provider_settlement_obligations?${params.toString()}`)
}

function allocateSettlement(rows, amountMinor, reserveBasisPoints) {
  let remaining = amountMinor
  const result = []
  for (const row of rows) {
    if (remaining <= 0n) break
    const outstanding = moneyToMinor(row.amount_outstanding)
    const received = outstanding < remaining ? outstanding : remaining
    const reserve = (received * BigInt(reserveBasisPoints)) / 10_000n
    result.push({
      row,
      amountExpectedMinor: outstanding,
      amountReceivedMinor: received,
      reserveMinor: reserve,
      status: received < outstanding ? 'partially_settled' : reserve > 0n ? 'held' : 'settled',
    })
    remaining -= received
  }
  return result
}

async function writeAllocation(batchIdValue, allocation, timestamp) {
  const row = allocation.row
  const itemId = randomId('seti')
  const ledgerTransactionId = randomId('led')
  const nextSettledAmount = moneyToMinor(row.settled_amount) + allocation.amountReceivedMinor
  const nextReserveAmount = moneyToMinor(row.settlement_reserved_amount) + allocation.reserveMinor

  await insertOne('ledger_transactions', {
    id: ledgerTransactionId,
    tenant_id: row.tenant_id,
    transfer_id: row.transfer_id,
    transaction_type: 'provider_settlement_clearing',
    settlement_batch_id: batchIdValue,
    description: `Provider settlement received from ${provider}`,
    metadata: {
      provider,
      provider_settlement_id: providerSettlementId,
      provider_transfer_id: row.provider_transfer_id,
      settlement_item_id: itemId,
      amount_expected: minorToMoney(allocation.amountExpectedMinor),
      amount_received: minorToMoney(allocation.amountReceivedMinor),
      reserve_amount: minorToMoney(allocation.reserveMinor),
    },
  })

  await insertMany('ledger_entries', [
    {
      ledger_transaction_id: ledgerTransactionId,
      tenant_id: row.tenant_id,
      account_code: 'provider_settlement_cash',
      direction: 'debit',
      amount: minorToMoney(allocation.amountReceivedMinor),
      currency,
    },
    {
      ledger_transaction_id: ledgerTransactionId,
      tenant_id: row.tenant_id,
      account_code: 'provider_fee_receivable',
      direction: 'credit',
      amount: minorToMoney(allocation.amountReceivedMinor),
      currency,
    },
  ])

  await insertOne('provider_settlement_items', {
    id: itemId,
    batch_id: batchIdValue,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    transfer_id: row.transfer_id,
    provider,
    provider_transfer_id: row.provider_transfer_id,
    kind: row.kind,
    status: allocation.status,
    gross_amount: row.gross_amount,
    provider_fee_amount: row.provider_fee,
    universa_fee_amount: row.universa_fee,
    tenant_fee_amount: row.tenant_fee,
    platform_fee_amount: row.platform_fee,
    network_fee_amount: row.network_fee,
    amount_expected: minorToMoney(allocation.amountExpectedMinor),
    amount_received: minorToMoney(allocation.amountReceivedMinor),
    reserve_amount: minorToMoney(allocation.reserveMinor),
    currency,
    ledger_transaction_id: ledgerTransactionId,
    metadata: {
      provider_settlement_id: providerSettlementId,
      customer_external_id: row.customer_external_id,
      customer_email: row.customer_email,
      previous_settlement_status: row.settlement_status,
    },
  })

  await patchSingle('ledger_transactions', `id=eq.${encodeURIComponent(ledgerTransactionId)}`, {
    settlement_item_id: itemId,
  })

  await patchSingle('transfers', `id=eq.${encodeURIComponent(row.transfer_id)}`, {
    settlement_status: allocation.status,
    settlement_batch_id: batchIdValue,
    settlement_item_id: itemId,
    settled_amount: minorToMoney(nextSettledAmount),
    settlement_reserved_amount: minorToMoney(nextReserveAmount),
    settled_at: allocation.status === 'partially_settled' ? null : timestamp,
    settlement_details: {
      provider,
      provider_settlement_id: providerSettlementId,
      settlement_batch_id: batchIdValue,
      settlement_item_id: itemId,
      ledger_transaction_id: ledgerTransactionId,
      amount_expected: minorToMoney(allocation.amountExpectedMinor),
      amount_received: minorToMoney(allocation.amountReceivedMinor),
      reserve_amount: minorToMoney(allocation.reserveMinor),
      allocated_at: timestamp,
    },
  })
}

async function insertOne(table, body) {
  const rows = await rest(table, {
    method: 'POST',
    body,
    headers: { Prefer: 'return=representation' },
  })
  return rows[0]
}

async function insertMany(table, body) {
  return await rest(table, {
    method: 'POST',
    body,
    headers: { Prefer: 'return=minimal' },
  })
}

async function patchSingle(table, query, body) {
  await rest(`${table}?${query}`, {
    method: 'PATCH',
    body,
    headers: { Prefer: 'return=minimal' },
  })
}

async function rest(path, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed ${response.status}: ${text}`)
  }
  return text ? JSON.parse(text) : null
}

function printPlan(plan) {
  console.log(`Provider: ${plan.provider}`)
  console.log(`Currency: ${plan.currency.toUpperCase()}`)
  console.log(`Mode: ${plan.execute ? 'execute' : 'dry-run'}`)
  console.log(`Outstanding: ${minorToMoney(plan.totalOutstanding)} ${plan.currency.toUpperCase()}`)
  console.log(`Received: ${minorToMoney(plan.receivedAmount)} ${plan.currency.toUpperCase()}`)
  console.log(`Allocated: ${minorToMoney(plan.allocatedAmount)} ${plan.currency.toUpperCase()}`)
  console.log(`Expected on included rows: ${minorToMoney(plan.expectedAmount)} ${plan.currency.toUpperCase()}`)
  console.log(`Reserve: ${minorToMoney(plan.reserveAmount)} ${plan.currency.toUpperCase()}`)
  if (plan.overage > 0n) console.log(`Overage: ${minorToMoney(plan.overage)} ${plan.currency.toUpperCase()}`)
  console.log('\nAllocations:')
  for (const allocation of plan.allocations) {
    const row = allocation.row
    console.log([
      row.tenant_id,
      row.customer_email || row.customer_id,
      row.transfer_id,
      allocation.status,
      `expected=${minorToMoney(allocation.amountExpectedMinor)}`,
      `received=${minorToMoney(allocation.amountReceivedMinor)}`,
      `reserve=${minorToMoney(allocation.reserveMinor)}`,
    ].join(' | '))
  }
}

function moneyToMinor(value) {
  const text = String(value ?? '0').trim()
  if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error(`Invalid money value: ${text}`)
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'))
}

function minorToMoney(value) {
  const amount = BigInt(value)
  const whole = amount / 100n
  const fraction = String(amount % 100n).padStart(2, '0')
  return `${whole}.${fraction}`
}

function randomId(prefix) {
  return `${prefix}_${randomBytes(16).toString('base64url')}`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

function readInteger(value, field) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`--${field} must be an integer`)
  return parsed
}

function optionalString(value) {
  if (value === undefined || value === null || value === true) return null
  const text = String(value).trim()
  return text || null
}

function printUsage() {
  console.log(`Usage:
  node scripts/settlement-batch.mjs --provider bridge --currency usd --amount 123.45
  node scripts/settlement-batch.mjs --provider bridge --currency usd --amount 123.45 --provider-settlement-id bridge_payout_123 --reserve-bps 500 --execute

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Options:
  --provider                 Provider name. Default: bridge
  --currency                 Settlement currency. Default: usd
  --amount                   Received batch amount. Defaults to all outstanding obligations.
  --tenant                   Restrict allocation to one tenant id.
  --period-start             Restrict transfer created_at lower bound.
  --period-end               Restrict transfer created_at upper bound.
  --provider-settlement-id   Provider payout/reference id.
  --reserve-bps              Hold-back reserve basis points. Default: 0
  --execute                  Write rows. Omit for dry-run.`)
}
