import { describe, expect, it } from 'vitest'
import { Secret, TOTP } from 'otpauth'
import { TotpService } from './totp.service'

describe('TotpService', () => {
  const service = new TotpService()

  describe('generateSecret', () => {
    it('returns a base32 secret and an otpauth:// enrolment URL', () => {
      const { secret, otpauthUrl } = service.generateSecret('admin@example.mv')
      expect(secret).toMatch(/^[A-Z2-7]+$/)
      expect(otpauthUrl).toContain('otpauth://totp/')
      expect(otpauthUrl).toContain('admin%40example.mv')
      expect(otpauthUrl).toContain(`secret=${secret}`)
    })

    it('never repeats', () => {
      const secrets = new Set(
        Array.from({ length: 20 }, () => service.generateSecret('a@b.mv').secret),
      )
      expect(secrets.size).toBe(20)
    })
  })

  describe('verify', () => {
    function codeFor(secret: string, at?: Date): string {
      const totp = new TOTP({
        issuer: 'Ride Master',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      })
      return totp.generate({ timestamp: (at ?? new Date()).getTime() })
    }

    it('accepts the current code', () => {
      const { secret } = service.generateSecret('admin@example.mv')
      expect(service.verify(codeFor(secret), secret)).toBe(true)
    })

    it('accepts the previous period code (clock skew window)', () => {
      const { secret } = service.generateSecret('admin@example.mv')
      const previous = codeFor(secret, new Date(Date.now() - 30_000))
      expect(service.verify(previous, secret)).toBe(true)
    })

    it('rejects a code from the wrong secret', () => {
      const a = service.generateSecret('a@example.mv').secret
      const b = service.generateSecret('b@example.mv').secret
      expect(service.verify(codeFor(b), a)).toBe(false)
    })

    it('rejects a garbage token', () => {
      const { secret } = service.generateSecret('admin@example.mv')
      expect(service.verify('000000', secret)).toBe(false)
      expect(service.verify('abcdef', secret)).toBe(false)
      expect(service.verify('', secret)).toBe(false)
    })

    it('rejects a code from a far-away timestamp (outside the window)', () => {
      const { secret } = service.generateSecret('admin@example.mv')
      const old = codeFor(secret, new Date(Date.now() - 10 * 60_000))
      expect(service.verify(old, secret)).toBe(false)
    })
  })
})
