/**
 * Typed fetch wrapper for the Ride Master API.
 *
 * - Sends cookies (the httpOnly refresh cookie lives on /api/v1/auth).
 * - Keeps the access token in memory only (never localStorage).
 * - On 401 it attempts a single silent refresh and retries once.
 * - All failures surface as ApiError with the server envelope when available.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: { field: string; message: string }[],
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface AuthTokens {
  accessToken: string
}

export interface RoleSummary {
  role: 'superadmin' | 'company_owner' | 'driver' | 'rider'
  adminLevel: 'super' | 'verifier' | 'support' | 'finance' | null
  company: {
    publicId: string
    name: string
    type: 'company' | 'individual'
    status: 'pending' | 'approved' | 'rejected' | 'suspended'
  } | null
}

export interface UserProfile {
  publicId: string
  fullName: string | null
  phone: string
  email: string | null
  language: 'en' | 'dv'
  activeRole: 'superadmin' | 'company_owner' | 'driver' | 'rider'
  adminLevel: 'super' | 'verifier' | 'support' | 'finance' | null
  roles: RoleSummary[]
}

export interface AuthResult {
  accessToken: string
  user: { publicId: string; activeRole: UserProfile['activeRole'] }
}

export interface AuditLogRow {
  publicId: string
  action: string
  entityType: string
  entityId: string | null
  actorPublicId: string | null
  actorName: string | null
  ipAddress: string | null
  createdAt: string
}

export interface AuditLogPage {
  data: AuditLogRow[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface NotificationRow {
  publicId: string
  channel: 'push' | 'sms' | 'in_app'
  title: string
  body: string
  readAt: string | null
  sentAt: string
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

interface ErrorEnvelope {
  statusCode: number
  error: string
  message: string
  requestId?: string
  fields?: { field: string; message: string }[]
}

function isEnvelope(body: unknown): body is ErrorEnvelope {
  return typeof body === 'object' && body !== null && 'statusCode' in body && 'message' in body
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toApiError(status: number, body: unknown): ApiError {
  if (isEnvelope(body)) {
    return new ApiError(
      status,
      typeof body.message === 'string' ? body.message : 'Request failed',
      body.fields,
      body.requestId,
    )
  }
  return new ApiError(status, `Request failed with status ${status}`)
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { retried?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiError(0, 'Cannot reach the server')
  }

  if (res.status === 401 && !init.retried && !path.startsWith('/auth/refresh')) {
    // One silent refresh, then retry with the new access token.
    try {
      await refreshSession()
      return apiFetch<T>(path, { ...init, retried: true })
    } catch {
      // Fall through: report the original 401 below.
    }
  }

  const body = await parseBody(res)
  if (!res.ok) throw toApiError(res.status, body)
  return body as T
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export const authApi = {
  requestOtp: (phone: string, purpose: 'login' | 'register') =>
    apiFetch<{ ttlSeconds: number }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose }),
    }),

  verifyOtp: async (phone: string, code: string, purpose: 'login' | 'register') => {
    const result = await apiFetch<AuthResult>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code, purpose }),
    })
    setAccessToken(result.accessToken)
    return result
  },

  adminLogin: (email: string, password: string) =>
    apiFetch<{ preAuthToken: string }>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  adminVerifyTotp: async (email: string, totpToken: string, preAuthToken: string) => {
    const result = await apiFetch<AuthResult>('/auth/admin/login/totp', {
      method: 'POST',
      body: JSON.stringify({ email, totpToken, preAuthToken }),
    })
    setAccessToken(result.accessToken)
    return result
  },

  logout: async () => {
    await apiFetch<void>('/auth/logout', { method: 'POST' })
    setAccessToken(null)
  },
}

export async function refreshSession(): Promise<AuthResult> {
  const result = await apiFetch<AuthResult>('/auth/refresh', { method: 'POST' })
  setAccessToken(result.accessToken)
  return result
}

// ---------------------------------------------------------------------------
// Domain endpoints available in Phase 1
// ---------------------------------------------------------------------------

export const meApi = {
  me: () => apiFetch<UserProfile>('/me'),
  switchRole: async (role: string, companyId?: string) => {
    const result = await apiFetch<AuthResult>('/me/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role, ...(companyId ? { companyId } : {}) }),
    })
    setAccessToken(result.accessToken)
    return result
  },
  setLanguage: (language: 'en' | 'dv') =>
    apiFetch<{ language: 'en' | 'dv' }>('/me/language', {
      method: 'PATCH',
      body: JSON.stringify({ language }),
    }),
}

export const notificationsApi = {
  list: () => apiFetch<NotificationRow[]>('/notifications'),
}

export const settingsApi = {
  all: () => apiFetch<Record<string, string | number | boolean>>('/settings'),
  update: (settingKey: string, value: string | number | boolean) =>
    apiFetch<{ settingKey: string; value: string }>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ settingKey, value }),
    }),
}

export const auditApi = {
  list: (params: { page?: number; limit?: number; action?: string; entityType?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.page) query.set('page', String(params.page))
    if (params.limit) query.set('limit', String(params.limit))
    if (params.action) query.set('action', params.action)
    if (params.entityType) query.set('entityType', params.entityType)
    const qs = query.toString()
    return apiFetch<AuditLogPage>(`/admin/audit-logs${qs ? `?${qs}` : ''}`)
  },
}
