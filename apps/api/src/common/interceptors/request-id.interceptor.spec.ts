import { describe, expect, it, vi } from 'vitest'
import { firstValueFrom, isObservable, of } from 'rxjs'
import { RequestIdInterceptor } from './request-id.interceptor'
import { currentRequestId } from '../context/request-context'

function makeContext(headers: Record<string, unknown>, type = 'http') {
  const setHeader = vi.fn()
  const req = { headers, ip: '10.0.0.1' }
  const context = {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader }),
    }),
  } as never
  const next = {
    // Evaluated at call time, inside requestContext.run.
    handle: () => of(currentRequestId()),
  }
  return { context, next, setHeader, req }
}

describe('RequestIdInterceptor', () => {
  const interceptor = new RequestIdInterceptor()

  it('honours a valid inbound X-Request-Id', async () => {
    const { context, next, setHeader } = makeContext({ 'x-request-id': 'inbound-1' })
    const value = await firstValueFrom(interceptor.intercept(context, next))
    expect(value).toBe('inbound-1')
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'inbound-1')
  })

  it('generates a UUID when the header is missing', async () => {
    const { context, next, setHeader } = makeContext({})
    const value = (await firstValueFrom(interceptor.intercept(context, next))) as string
    expect(value).toMatch(/^[0-9a-f-]{36}$/)
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', value)
  })

  it('rejects oversized inbound ids', async () => {
    const { context, next } = makeContext({ 'x-request-id': 'x'.repeat(101) })
    const value = (await firstValueFrom(interceptor.intercept(context, next))) as string
    expect(value).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('skips non-http contexts without touching the response', async () => {
    const { context, next, setHeader } = makeContext({}, 'ws')
    const result = interceptor.intercept(context, next)
    expect(isObservable(result)).toBe(true)
    expect(setHeader).not.toHaveBeenCalled()
  })
})
