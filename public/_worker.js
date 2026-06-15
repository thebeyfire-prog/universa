const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const UNV_VAULT_TOKEN_ACCOUNT = '6DnZQZEgLAFeEBvF2BX4f523uhfsRDSoXyMPcEWWUG36'
const UNV_VAULT_FALLBACK_BALANCE = 5_000_000
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com'
const JUPITER_PRICE_ENDPOINT = 'https://lite-api.jup.ag/price/v3'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/unv-vault') return handleUnvVault(request)
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

async function fetchVaultBalance() {
  const response = await fetch(SOLANA_RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'unv-vault-balance',
      method: 'getTokenAccountBalance',
      params: [UNV_VAULT_TOKEN_ACCOUNT],
    }),
  })
  if (!response.ok) return null
  const payload = await response.json()
  const value = payload?.result?.value
  const amount = Number(value?.uiAmountString ?? value?.uiAmount)
  return Number.isFinite(amount) ? amount : null
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
