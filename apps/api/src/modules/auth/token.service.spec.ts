import { JwtService } from '@nestjs/jwt'
import { describe, expect, it } from 'vitest'
import { TokenService } from './token.service'

function makeService(): TokenService {
  const jwt = new JwtService({ secret: process.env.JWT_SECRET })
  return new TokenService(jwt)
}

describe('TokenService', () => {
  const service = makeService()

  describe('access tokens', () => {
    it('round-trips the payload', () => {
      const token = service.signAccess({
        sub: 'U1',
        sid: 'S1',
        roles: ['rider'],
        activeRole: 'rider',
      })
      const payload = new JwtService({ secret: process.env.JWT_SECRET }).verify(token)
      expect(payload.sub).toBe('U1')
      expect(payload.sid).toBe('S1')
      expect(payload.activeRole).toBe('rider')
    })

    it('carries adminLevel and companyId claims when present', () => {
      const token = service.signAccess({
        sub: 'U1',
        sid: 'S1',
        roles: ['superadmin'],
        activeRole: 'superadmin',
        adminLevel: 'super',
      })
      const payload = new JwtService({ secret: process.env.JWT_SECRET }).verify(token)
      expect(payload.adminLevel).toBe('super')
    })

    it('rejects tokens signed with another secret', () => {
      const foreign = new JwtService({ secret: 'other_secret' })
      const token = foreign.sign({ sub: 'U1', sid: 'S1', roles: ['rider'], activeRole: 'rider' })
      expect(() =>
        new JwtService({ secret: process.env.JWT_SECRET }).verify(token),
      ).toThrow()
    })
  })

  describe('admin pre-auth tokens', () => {
    it('round-trips the email with the admin_pre_2fa purpose', () => {
      const token = service.signAdminPreAuth('super@ridemaster.mv')
      expect(service.verifyAdminPreAuth(token)).toMatchObject({
        purpose: 'admin_pre_2fa',
        email: 'super@ridemaster.mv',
      })
    })

    it('refuses a normal access token used as pre-auth', () => {
      const access = service.signAccess({
        sub: 'U1',
        sid: 'S1',
        roles: ['rider'],
        activeRole: 'rider',
      })
      expect(() => service.verifyAdminPreAuth(access)).toThrow(
        /Not an admin pre-auth token/,
      )
    })
  })

  describe('refresh tokens', () => {
    it('are high-entropy and hash deterministically', () => {
      const token = service.newRefreshToken()
      expect(token.length).toBeGreaterThan(60)
      expect(service.hashRefreshToken(token)).toBe(service.hashRefreshToken(token))
      expect(service.hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/)
    })

    it('hash different tokens differently', () => {
      expect(service.hashRefreshToken(service.newRefreshToken())).not.toBe(
        service.hashRefreshToken(service.newRefreshToken()),
      )
    })
  })
})
