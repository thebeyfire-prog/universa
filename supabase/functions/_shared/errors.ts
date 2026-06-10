export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function requireString(
  value: unknown,
  field: string,
  options: { max?: number; pattern?: RegExp } = {},
): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError(400, 'invalid_request', `${field} is required`)
  if (options.max && normalized.length > options.max) {
    throw new ApiError(400, 'invalid_request', `${field} is too long`)
  }
  if (options.pattern && !options.pattern.test(normalized)) {
    throw new ApiError(400, 'invalid_request', `${field} is invalid`)
  }
  return normalized
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', `${field} must be an object`)
  }
  return value as Record<string, unknown>
}
