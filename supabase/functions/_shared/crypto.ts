const encoder = new TextEncoder()

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return bytesToHex(new Uint8Array(digest))
}

export async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input))
  return bytesToHex(new Uint8Array(signature))
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false

  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index++) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  }
  return difference === 0
}

export async function decryptSecret(payload: string): Promise<string> {
  if (payload.startsWith('env:')) {
    const name = payload.slice(4)
    const value = Deno.env.get(name) ?? ''
    if (!value) throw new Error(`${name} is not configured`)
    return value
  }

  const [version, ivEncoded, ciphertextEncoded] = payload.split('.')
  if (version !== 'v1' || !ivEncoded || !ciphertextEncoded) {
    throw new Error('Unsupported API secret payload')
  }

  const master = Deno.env.get('API_KEYS_MASTER_SECRET') ?? ''
  if (!master) throw new Error('API_KEYS_MASTER_SECRET is not configured')

  const masterDigest = await crypto.subtle.digest('SHA-256', encoder.encode(master))
  const key = await crypto.subtle.importKey(
    'raw',
    masterDigest,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivEncoded) as BufferSource },
    key,
    fromBase64Url(ciphertextEncoded) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

export async function encryptSecret(secret: string): Promise<string> {
  const master = Deno.env.get('API_KEYS_MASTER_SECRET') ?? ''
  if (!master) throw new Error('API_KEYS_MASTER_SECRET is not configured')

  const masterDigest = await crypto.subtle.digest('SHA-256', encoder.encode(master))
  const key = await crypto.subtle.importKey(
    'raw',
    masterDigest,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(secret),
  )
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `${prefix}_${toBase64Url(bytes)}`
}

export function randomToken(prefix: string, bytesLength = 24): string {
  const bytes = new Uint8Array(bytesLength)
  crypto.getRandomValues(bytes)
  return `${prefix}_${toBase64Url(bytes)}`
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
