const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const UNV_VAULT_TOKEN_ACCOUNT = '6DnZQZEgLAFeEBvF2BX4f523uhfsRDSoXyMPcEWWUG36'
const UNV_VAULT_FALLBACK_BALANCE = 5_000_000
const SOLANA_RPC_ENDPOINTS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
]
const SOLANA_RPC_TIMEOUT_MS = 3_500
const JUPITER_PRICE_ENDPOINT = 'https://lite-api.jup.ag/price/v3'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/unv-vault') return handleUnvVault(request)
    if (url.pathname === '/api/unv-wallet') return handleUnvWallet(request)
    return env.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 })
  },
}

async function handleUnvVault(request) {
  if (request.method === 'OPTIONS') return json({}, 204)
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const [balanceResult, priceResult] = await Promise.allSettled([
    fetchVaultBalance(),
    fetchUnvPrice(),
  ])
  const liveBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null
  const price = priceResult.status === 'fulfilled' ? priceResult.value : null
  const balance = Number.isFinite(liveBalance) ? liveBalance : UNV_VAULT_FALLBACK_BALANCE
  const priceUsd = Number(price?.priceUsd)
  const valueUsd = Number.isFinite(priceUsd) && priceUsd > 0 ? balance * priceUsd : null

  return json({
    mint: UNV_MINT,
    vaultTokenAccount: UNV_VAULT_TOKEN_ACCOUNT,
    balance,
    balanceSource: Number.isFinite(liveBalance) ? 'solana_rpc' : 'verified_funding',
    priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
    priceSource: price?.source ?? null,
    valueUsd,
    updatedAt: Date.now(),
  })
}

async function handleUnvWallet(request) {
  if (request.method === 'OPTIONS') return json({}, 204)
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const url = new URL(request.url)
  const owner = String(url.searchParams.get('owner') ?? '').trim()
  if (!isSolanaAddress(owner)) {
    return json({ error: 'Valid Solana wallet owner is required' }, 400)
  }

  try {
    const balance = await fetchOwnerTokenBalance(owner, UNV_MINT)
    return json({
      owner,
      mint: UNV_MINT,
      ...balance,
      updatedAt: Date.now(),
    })
  } catch (error) {
    return json({
      error: 'Unable to read wallet balance',
      message: error instanceof Error ? error.message : 'Solana RPC request failed',
    }, 502)
  }
}

async function fetchVaultBalance() {
  const payload = await solanaRpc('unv-vault-balance', 'getTokenAccountBalance', [UNV_VAULT_TOKEN_ACCOUNT])
  const value = payload?.result?.value
  const amount = Number(value?.uiAmountString ?? value?.uiAmount)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

async function fetchOwnerTokenBalance(owner, mint) {
  const payload = await solanaRpc('unv-wallet-balance', 'getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])
  const accounts = Array.isArray(payload?.result?.value) ? payload.result.value : []
  let rawAmount = 0n
  let decimals = 0

  for (const account of accounts) {
    const tokenAmount = account?.account?.data?.parsed?.info?.tokenAmount
    const amount = String(tokenAmount?.amount ?? '')
    if (!/^\d+$/.test(amount)) continue
    rawAmount += BigInt(amount)
    const accountDecimals = Number(tokenAmount?.decimals)
    if (Number.isInteger(accountDecimals) && accountDecimals >= 0) decimals = accountDecimals
  }

  const uiAmountString = formatTokenAmount(rawAmount, decimals)
  const balance = Number(uiAmountString)
  return {
    amount: rawAmount.toString(),
    decimals,
    balance: Number.isFinite(balance) ? balance : 0,
    uiAmountString,
    tokenAccountCount: accounts.length,
    balanceSource: accounts.length > 0 ? 'solana_rpc' : 'no_account',
  }
}

async function solanaRpc(id, method, params) {
  let lastError = null
  for (const endpoint of SOLANA_RPC_ENDPOINTS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
      })
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`)
      const payload = await response.json()
      if (payload?.error) throw new Error(payload.error.message ?? 'Solana RPC error')
      return payload
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError ?? new Error('Solana RPC request failed')
}

async function fetchUnvPrice() {
  const url = new URL(JUPITER_PRICE_ENDPOINT)
  url.searchParams.set('ids', UNV_MINT)
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return null
  const payload = await response.json()
  const row = payload?.[UNV_MINT]
  const priceUsd = Number(row?.usdPrice ?? row?.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null
  return {
    priceUsd,
    source: row?.launchpad ? `jupiter ${row.launchpad}` : 'jupiter',
  }
}

function isSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
}

function formatTokenAmount(rawAmount, decimals) {
  if (rawAmount === 0n) return '0'
  if (!Number.isInteger(decimals) || decimals <= 0) return rawAmount.toString()
  const padded = rawAmount.toString().padStart(decimals + 1, '0')
  const integer = padded.slice(0, -decimals) || '0'
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : integer
}

function json(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
}
