import { AsyncLocalStorage } from 'async_hooks'

export interface RequestContextData {
  requestId: string
  ip?: string
}

/**
 * Per-request context available anywhere without prop-drilling.
 * Populated by RequestIdInterceptor; read by AuditService and error filter.
 */
export const requestContext = new AsyncLocalStorage<RequestContextData>()

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId
}

export function currentRequestIp(): string | undefined {
  return requestContext.getStore()?.ip
}
