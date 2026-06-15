import { ApiError } from './errors.ts'
import { randomId } from './crypto.ts'

const DEFAULT_PRIVY_API = 'https://api.privy.io/v1'
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export type PrivySolanaWallet = {
  id: string
  address: string
  appId: string
  mock: boolean
  raw: Record<string, unknown>
}

export type PrivyWalletExport = {
  encapsulated_key?: string
  ciphertext?: string
  raw: Record<string, unknown>
}

export async function createPrivySolanaWallet(
  _metadata: Record<string, unknown> = {},
): Promise<PrivySolanaWallet> {
  const config = privyConfig()
  if (useMockPrivyWallets(config)) return mockPrivySolanaWallet()
  if (!config.appId || !config.appSecret) {
    throw new ApiError(500, 'wallet_provider_misconfigured', 'Privy Solana app credentials are not configured')
  }
  if (!config.authPublicKey) {
    throw new ApiError(500, 'wallet_provider_misconfigured', 'Privy wallet authorization public key is not configured')
  }

  const res = await fetch(`${config.apiUrl}/wallets`, {
    method: 'POST',
    headers: privyHeaders(config.appId, config.appSecret),
    body: JSON.stringify({
      chain_type: 'solana',
      owner: { public_key: config.authPublicKey },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(
      providerStatus(res.status),
      'wallet_provider_error',
      'Privy wallet provisioning failed',
      data,
    )
  }

  const id = typeof data?.id === 'string' ? data.id : ''
  const address = typeof data?.address === 'string' ? data.address : ''
  if (!id || !address) {
    throw new ApiError(502, 'wallet_provider_error', 'Privy did not return a wallet address', data)
  }

  return {
    id,
    address,
    appId: config.appId,
    mock: false,
    raw: data as Record<string, unknown>,
  }
}

export async function exportPrivySolanaWallet(
  walletId: string,
  recipientPublicKey: string,
): Promise<PrivyWalletExport> {
  const config = privyConfig()
  if (useMockPrivyWallets(config)) {
    return {
      encapsulated_key: `mock_enc_${randomId('exp').slice(4)}`,
      ciphertext: `mock_cipher_${randomId('exp').slice(4)}`,
      raw: { mock: true, wallet_id: walletId },
    }
  }
  if (!config.appId || !config.appSecret) {
    throw new ApiError(500, 'wallet_provider_misconfigured', 'Privy Solana app credentials are not configured')
  }
  if (!config.authPrivateKey) {
    throw new ApiError(500, 'wallet_export_not_configured', 'Privy wallet export signing key is not configured')
  }

  const url = `${config.apiUrl}/wallets/${encodeURIComponent(walletId)}/export`
  const body = {
    encryption_type: 'HPKE',
    recipient_public_key: recipientPublicKey,
  }
  const signature = await signAuthorization({
    url,
    body,
    appId: config.appId,
    privateKeyHex: config.authPrivateKey,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...privyHeaders(config.appId, config.appSecret),
      'privy-authorization-signature': signature,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(
      providerStatus(res.status),
      'wallet_export_failed',
      String((data as any)?.message ?? (data as any)?.error ?? 'Privy wallet export failed'),
      data,
    )
  }

  return {
    encapsulated_key: typeof (data as any)?.encapsulated_key === 'string'
      ? (data as any).encapsulated_key
      : undefined,
    ciphertext: typeof (data as any)?.ciphertext === 'string' ? (data as any).ciphertext : undefined,
    raw: data as Record<string, unknown>,
  }
}

function privyConfig() {
  return {
    apiUrl: (Deno.env.get('PRIVY_API_URL') ?? DEFAULT_PRIVY_API).replace(/\/+$/, ''),
    appId: Deno.env.get('PRIVY_SOL_APP_ID') ?? '',
    appSecret: Deno.env.get('PRIVY_SOL_APP_SECRET') ?? '',
    authPublicKey: Deno.env.get('PRIVY_AUTH_PUB_KEY') ?? '',
    authPrivateKey: Deno.env.get('PRIVY_AUTH_PRIV_KEY') ?? '',
    walletMode: (Deno.env.get('PRIVY_WALLET_MODE') ?? '').toLowerCase(),
    platformProvider: (Deno.env.get('PLATFORM_PROVIDER') ?? 'mock').toLowerCase(),
  }
}

function useMockPrivyWallets(config: ReturnType<typeof privyConfig>): boolean {
  if (config.walletMode === 'live') return false
  if (config.walletMode === 'mock') return true
  return config.platformProvider === 'mock' && (!config.appId || !config.appSecret)
}

function privyHeaders(appId: string, appSecret: string): HeadersInit {
  return {
    Authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`,
    'privy-app-id': appId,
    'Content-Type': 'application/json',
  }
}

function mockPrivySolanaWallet(): PrivySolanaWallet {
  const address = randomBase58Address()
  return {
    id: randomId('privy_wallet'),
    address,
    appId: 'mock_privy_sol',
    mock: true,
    raw: { mock: true, chain_type: 'solana', address },
  }
}

function randomBase58Address(): string {
  const bytes = new Uint8Array(44)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += BASE58_ALPHABET[byte % BASE58_ALPHABET.length]
  return out
}

function providerStatus(status: number): number {
  return status === 400 || status === 422 ? 400 : 502
}

function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${jcs(object[key])}`).join(',')}}`
}

async function signAuthorization(input: {
  url: string
  body: unknown
  appId: string
  privateKeyHex: string
}): Promise<string> {
  const { p256 } = await import('https://esm.sh/@noble/curves@1.4.0/p256')
  const payload = jcs({
    version: 1,
    method: 'POST',
    url: input.url,
    body: input.body,
    headers: { 'privy-app-id': input.appId },
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  const signature = p256.sign(new Uint8Array(digest), hexToBytes(input.privateKeyHex))
  return bytesToBase64(signature.toDERRawBytes())
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]*$/i.test(normalized) || normalized.length % 2 !== 0) {
    throw new ApiError(500, 'wallet_export_not_configured', 'Privy wallet export signing key is invalid')
  }
  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
