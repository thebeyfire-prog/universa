import { ApiError } from './errors.ts'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    'content-type',
    'authorization',
    'apikey',
    'idempotency-key',
    'x-universa-api-key',
    'x-universa-timestamp',
    'x-universa-nonce',
    'x-universa-signature',
  ].join(', '),
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

export function normalizedApiPath(url: URL): string {
  let path = url.pathname
    .replace(/^\/functions\/v1\/platform-api/, '')
    .replace(/^\/platform-api/, '')
  if (!path) path = '/'
  return `${path}${url.search}`
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? ''
  ).trim()
}

export function parseJson(rawBody: string): Record<string, unknown> {
  if (!rawBody) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must contain valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid_json', 'Request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
