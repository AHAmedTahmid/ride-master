import { describe, expect, it } from 'vitest'
import {
  currentRequestId,
  currentRequestIp,
  requestContext,
} from './request-context'

describe('request context (AsyncLocalStorage)', () => {
  it('exposes the request id and ip inside the store', () => {
    requestContext.run({ requestId: 'req-1', ip: '127.0.0.1' }, () => {
      expect(currentRequestId()).toBe('req-1')
      expect(currentRequestIp()).toBe('127.0.0.1')
    })
  })

  it('returns undefined outside any store', () => {
    expect(currentRequestId()).toBeUndefined()
    expect(currentRequestIp()).toBeUndefined()
  })

  it('does not leak between concurrent contexts', () => {
    requestContext.run({ requestId: 'a' }, () => {
      requestContext.run({ requestId: 'b' }, () => {
        expect(currentRequestId()).toBe('b')
      })
      expect(currentRequestId()).toBe('a')
    })
  })
})
