import { describe, expect, it } from 'vitest'
import { JwtStrategy, JwtVerifiedPayload } from './jwt.strategy'

describe('JwtStrategy', () => {
  const strategy = new JwtStrategy()

  it('passes the verified payload through (DB checks live in JwtAuthGuard)', () => {
    const payload: JwtVerifiedPayload = {
      sub: 'U1',
      sid: 'S1',
      roles: ['rider'],
      activeRole: 'rider',
    }
    expect(strategy.validate(payload)).toEqual(payload)
  })

  it('keeps optional claims intact', () => {
    const payload: JwtVerifiedPayload = {
      sub: 'U1',
      sid: 'S1',
      roles: ['superadmin'],
      activeRole: 'superadmin',
      adminLevel: 'finance',
    }
    expect(strategy.validate(payload).adminLevel).toBe('finance')
  })
})
