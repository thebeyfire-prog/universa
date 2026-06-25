const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const UNV_VAULT_TOKEN_ACCOUNT = '6DnZQZEgLAFeEBvF2BX4f523uhfsRDSoXyMPcEWWUG36'
const UNV_VAULT_FALLBACK_BALANCE = 5_000_000
const SOLANA_PUBLIC_RPC_ENDPOINTS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
]
const SOLANA_RPC_TIMEOUT_MS = 3_500
const JUPITER_PRICE_ENDPOINT = 'https://lite-api.jup.ag/price/v3'
const JUPITER_HOLDINGS_ENDPOINT = 'https://lite-api.jup.ag/ultra/v1/holdings'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/unv-vault') return handleUnvVault(request, env)
    if (url.pathname === '/api/unv-wallet') return handleUnvWallet(request, env)
    return env.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 })
  },
}

async function handleUnvVault(request, env) {
  if (request.method === 'OPTIONS') return json({}, 204)
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const [balanceResult, priceResult] = await Promise.allSettled([
    fetchVaultBalance(env),
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

async function handleUnvWallet(request, env) {
  if (request.method === 'OPTIONS') return json({}, 204)
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const url = new URL(request.url)
  const owner = String(url.searchParams.get('owner') ?? '').trim()
  if (!isSolanaAddress(owner)) {
    return json({ error: 'Valid Solana wallet owner is required' }, 400)
  }

  try {
    const balance = await fetchOwnerTokenBalance(owner, UNV_MINT, env)
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

async function fetchVaultBalance(env) {
  const payload = await solanaRpc('unv-vault-balance', 'getTokenAccountBalance', [UNV_VAULT_TOKEN_ACCOUNT], env)
  const value = payload?.result?.value
  const amount = Number(value?.uiAmountString ?? value?.uiAmount)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

async function fetchOwnerTokenBalance(owner, mint, env) {
  const jupiterBalance = await fetchJupiterTokenBalance(owner, mint).catch(() => null)
  if (jupiterBalance) return jupiterBalance

  const payload = await solanaRpc('unv-wallet-balance', 'getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ], env)
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

async function fetchJupiterTokenBalance(owner, mint) {
  const response = await fetchWithTimeout(`${JUPITER_HOLDINGS_ENDPOINT}/${owner}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Jupiter holdings returned ${response.status}`)
  const payload = await response.json()
  const accounts = Array.isArray(payload?.tokens?.[mint]) ? payload.tokens[mint] : []
  let rawAmount = 0n
  let decimals = 0

  for (const account of accounts) {
    const amount = String(account?.amount ?? '')
    if (!/^\d+$/.test(amount)) continue
    rawAmount += BigInt(amount)
    const accountDecimals = Number(account?.decimals)
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
    balanceSource: accounts.length > 0 ? 'jupiter_holdings' : 'no_account',
  }
}

async function solanaRpc(id, method, params, env) {
  let lastError = null
  for (const endpoint of solanaRpcEndpoints(env)) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    }
  }
  throw lastError ?? new Error('Solana RPC request failed')
}

function solanaRpcEndpoints(env = {}) {
  return Array.from(new Set([
    env.MONET_SOLANA_RPC_URL,
    env.SOLANA_RPC_URL,
    env.SOLANA_RPC_FALLBACK_URL,
    env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : '',
    ...SOLANA_PUBLIC_RPC_ENDPOINTS,
  ].map((url) => String(url ?? '').trim()).filter(Boolean)))
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
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
