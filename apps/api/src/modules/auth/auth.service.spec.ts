import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '../../common/utils/crypto'
import { AuthService } from './auth.service'

type UserRow = {
  id: bigint
  publicId: string
  fullName: string
  phone: string | null
  email: string | null
  language: string
  status: string
  deletedAt: Date | null
  passwordHash: string | null
  totpSecretEnc: string | null
  roles: Array<{
    id: bigint
    role: string
    status: string
    companyId: bigint | null
    adminLevel: string | null
  }>
}

function makeUser(overrides: Partial<UserRow>): UserRow {
  return {
    id: 1n,
    publicId: 'U1',
    fullName: 'Test',
    phone: '+9607712345',
    email: null,
    language: 'en',
    status: 'active',
    deletedAt: null,
    passwordHash: null,
    totpSecretEnc: null,
    roles: [{ id: 10n, role: 'rider', status: 'active', companyId: null, adminLevel: null }],
    ...overrides,
  }
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 100n,
    publicId: 'SESS1',
    userId: 1n,
    userRoleId: 10n,
    refreshTokenHash: 'hash',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: makeUser({}),
    userRole: { id: 10n, role: 'rider', companyId: null, adminLevel: null },
    ...overrides,
  }
}

function makeHarness() {
  const session = makeSession()
  const prisma = {
    user: {
      findUnique: vi.fn(async () => makeUser({})),
      create: vi.fn(async (args: { data: { roles: { create: { role: string } } } }) =>
        makeUser({
          id: 2n,
          publicId: 'U2',
          roles: [
            {
              id: 20n,
              role: args.data.roles.create.role,
              status: 'active',
              companyId: null,
              adminLevel: null,
            },
          ],
        }),
      ),
      update: vi.fn(async () => makeUser({})),
    },
    userRole: {
      findUnique: vi.fn(async () => session.userRole),
    },
    company: {
      findUnique: vi.fn(async () => ({ publicId: 'CO1' })),
      findFirst: vi.fn(async () => ({ id: 5n, publicId: 'CO1', deletedAt: null })),
    },
    session: {
      create: vi.fn(async () => session),
      update: vi.fn(async () => session),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => session),
      findFirst: vi.fn(async () => session),
    },
  }

  const tokens = {
    signAccess: vi.fn(() => 'access-token'),
    signAdminPreAuth: vi.fn(() => 'preauth-token'),
    verifyAdminPreAuth: vi.fn(() => ({
      purpose: 'admin_pre_2fa',
      email: 'super@test.local',
    })),
    newRefreshToken: vi.fn(() => 'refresh-token'),
    hashRefreshToken: vi.fn((t: string) => `hash:${t}`),
  }
  const otp = {
    requestOtp: vi.fn(async () => ({ expiresInSeconds: 300 })),
    verifyOtp: vi.fn(async () => true),
  }
  const totp = {
    generateSecret: vi.fn(() => ({ secret: 'SECRET', otpauthUrl: 'otpauth://x' })),
    verify: vi.fn(() => true),
  }
  const audit = { log: vi.fn(async () => undefined) }

  const service = new AuthService(
    prisma as never,
    tokens as never,
    otp as never,
    totp as never,
    audit as never,
  )
  return { service, prisma, tokens, otp, totp, audit }
}

describe('AuthService', () => {
  describe('verifyOtp', () => {
    let h: ReturnType<typeof makeHarness>

    beforeEach(() => {
      h = makeHarness()
    })

    it('rejects an invalid code before touching the user store', async () => {
      h.otp.verifyOtp.mockResolvedValue(false)
      await expect(
        h.service.verifyOtp({ phone: '7712345', code: '000000', purpose: 'login' }),
      ).rejects.toThrow(UnauthorizedException)
      expect(h.prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('logs in an existing user and issues a session', async () => {
      const result = await h.service.verifyOtp({
        phone: '7712345',
        code: '123456',
        purpose: 'login',
      })
      expect(result.accessToken).toBe('access-token')
      expect(result.refreshToken).toBe('refresh-token')
      expect(result.user.activeRole).toBe('rider')
      expect(h.prisma.session.create).toHaveBeenCalledTimes(1)
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGIN_OTP' }),
      )
    })

    it('creates a rider on purpose=register when no account exists', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(null)
      const result = await h.service.verifyOtp({
        phone: '7712345',
        code: '123456',
        purpose: 'register',
      })
      expect(h.prisma.user.create).toHaveBeenCalledTimes(1)
      expect(result.user.publicId).toBe('U2')
    })

    it('refuses login for an unknown number (must register first)', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(null)
      await expect(
        h.service.verifyOtp({ phone: '7712345', code: '123456', purpose: 'login' }),
      ).rejects.toThrow(/Register first/)
    })

    it('refuses a suspended account', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ status: 'suspended' }),
      )
      await expect(
        h.service.verifyOtp({ phone: '7712345', code: '123456', purpose: 'login' }),
      ).rejects.toThrow(/suspended/)
    })

    it('revokes other sessions on driver login (single-session rule)', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          roles: [
            { id: 10n, role: 'driver', status: 'active', companyId: 5n, adminLevel: null },
          ],
        }),
      )
      await h.service.verifyOtp({ phone: '7712345', code: '123456', purpose: 'login' })
      expect(h.prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1n, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      )
    })

    it('multi-role users keep the first role by default', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          roles: [
            { id: 11n, role: 'rider', status: 'active', companyId: null, adminLevel: null },
            { id: 12n, role: 'driver', status: 'active', companyId: 5n, adminLevel: null },
          ],
        }),
      )
      const result = await h.service.verifyOtp({
        phone: '7712345',
        code: '123456',
        purpose: 'login',
      })
      expect(result.user.activeRole).toBe('rider')
    })
  })

  describe('adminLogin', () => {
    let h: ReturnType<typeof makeHarness>

    beforeEach(() => {
      h = makeHarness()
    })

    it('returns a pre-auth token for a valid password', async () => {
      const argon2 = await import('argon2')
      const hash = await argon2.hash('correct-password', { type: argon2.argon2id })
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          email: 'super@test.local',
          passwordHash: hash,
          roles: [
            {
              id: 30n,
              role: 'superadmin',
              status: 'active',
              companyId: null,
              adminLevel: 'super',
            },
          ],
        }),
      )
      const result = await h.service.adminLogin('super@test.local', 'correct-password')
      expect(result).toEqual({ preAuthToken: 'preauth-token' })
      expect(h.tokens.signAdminPreAuth).toHaveBeenCalledWith('super@test.local')
    })

    it('rejects a wrong password and audits the failure', async () => {
      const argon2 = await import('argon2')
      const hash = await argon2.hash('correct-password', { type: argon2.argon2id })
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ email: 'super@test.local', passwordHash: hash }),
      )
      await expect(h.service.adminLogin('super@test.local', 'nope')).rejects.toThrow(
        UnauthorizedException,
      )
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { result: 'bad_password' } }),
      )
    })

    it('rejects unknown emails without revealing existence', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(null)
      await expect(h.service.adminLogin('ghost@test.local', 'pw')).rejects.toThrow(
        'Invalid email or password',
      )
    })

    it('rejects a user without a superadmin role', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ email: 'x@test.local', passwordHash: 'h', roles: [] }),
      )
      await expect(h.service.adminLogin('x@test.local', 'pw')).rejects.toThrow(
        UnauthorizedException,
      )
    })
  })

  describe('adminVerifyTotp', () => {
    let h: ReturnType<typeof makeHarness>

    beforeEach(() => {
      h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({
          email: 'super@test.local',
          totpSecretEnc: encryptSecret('JBSWY3DPEHPK3PXP'),
          roles: [
            {
              id: 30n,
              role: 'superadmin',
              status: 'active',
              companyId: null,
              adminLevel: 'super',
            },
          ],
        }),
      )
    })

    it('issues tokens for a valid TOTP', async () => {
      const result = await h.service.adminVerifyTotp({
        email: 'super@test.local',
        totpToken: '123456',
        preAuthToken: 'preauth',
      })
      expect(result.accessToken).toBe('access-token')
      expect(result.user.adminLevel).toBe('super')
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { result: 'success' } }),
      )
    })

    it('rejects an invalid pre-auth token', async () => {
      h.tokens.verifyAdminPreAuth.mockImplementationOnce(() => {
        throw new Error('bad')
      })
      await expect(
        h.service.adminVerifyTotp({
          email: 'super@test.local',
          totpToken: '123456',
          preAuthToken: 'preauth',
        }),
      ).rejects.toThrow(/Pre-auth token/)
    })

    it('rejects a pre-auth token for a different email', async () => {
      h.tokens.verifyAdminPreAuth.mockReturnValueOnce({
        purpose: 'admin_pre_2fa',
        email: 'other@test.local',
      })
      await expect(
        h.service.adminVerifyTotp({
          email: 'super@test.local',
          totpToken: '123456',
          preAuthToken: 'preauth',
        }),
      ).rejects.toThrow(/does not match/)
    })

    it('rejects a wrong TOTP and audits it', async () => {
      h.totp.verify.mockReturnValueOnce(false)
      await expect(
        h.service.adminVerifyTotp({
          email: 'super@test.local',
          totpToken: '000000',
          preAuthToken: 'preauth',
        }),
      ).rejects.toThrow(/Invalid authentication code/)
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { result: 'bad_totp' } }),
      )
    })

    it('rejects accounts without an encrypted TOTP secret', async () => {
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({ email: 'super@test.local', totpSecretEnc: null }),
      )
      await expect(
        h.service.adminVerifyTotp({
          email: 'super@test.local',
          totpToken: '123456',
          preAuthToken: 'preauth',
        }),
      ).rejects.toThrow(/Invalid credentials/)
    })
  })

  describe('refresh', () => {
    let h: ReturnType<typeof makeHarness>

    beforeEach(() => {
      h = makeHarness()
    })

    it('rotates the refresh token on the same session', async () => {
      const result = await h.service.refresh('old-refresh')
      expect(result.refreshToken).toBe('refresh-token')
      expect(h.prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100n },
          data: expect.objectContaining({ refreshTokenHash: 'hash:refresh-token' }),
        }),
      )
    })

    it('rejects a missing cookie', async () => {
      await expect(h.service.refresh(undefined)).rejects.toThrow(/Missing refresh token/)
    })

    it('rejects an unknown/revoked token', async () => {
      h.prisma.session.findFirst.mockResolvedValueOnce(null)
      await expect(h.service.refresh('old-refresh')).rejects.toThrow(/Session expired/)
    })

    it('rejects an expired session', async () => {
      h.prisma.session.findFirst.mockResolvedValueOnce(
        makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      )
      await expect(h.service.refresh('old-refresh')).rejects.toThrow(/Session expired/)
    })

    it('rejects a suspended user', async () => {
      h.prisma.session.findFirst.mockResolvedValueOnce(
        makeSession({ user: makeUser({ status: 'suspended' }) }),
      )
      await expect(h.service.refresh('old-refresh')).rejects.toThrow(/not active/)
    })
  })

  describe('logout', () => {
    it('revokes only the presented session', async () => {
      const h = makeHarness()
      await h.service.logout('SESS1', 'U1')
      expect(h.prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { publicId: 'SESS1', revokedAt: null },
        }),
      )
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGOUT' }),
      )
    })
  })

  describe('switchRole', () => {
    it('switches to a role the user holds', async () => {
      const h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({
          roles: [
            { id: 10n, role: 'rider', status: 'active', companyId: null, adminLevel: null },
            { id: 11n, role: 'driver', status: 'active', companyId: 5n, adminLevel: null },
          ],
        }),
      )
      h.prisma.userRole.findUnique.mockResolvedValueOnce({
        id: 11n,
        role: 'driver',
        companyId: 5n,
        adminLevel: null,
      })
      const result = await h.service.switchRole({ userId: 1n, sessionId: 100n, role: 'driver' })
      expect(result.user.activeRole).toBe('driver')
      expect(h.prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userRoleId: 11n } }),
      )
    })

    it('rejects a role the user does not hold (negative case)', async () => {
      const h = makeHarness()
      await expect(
        h.service.switchRole({ userId: 1n, sessionId: 100n, role: 'superadmin' }),
      ).rejects.toThrow(/not active/)
    })

    it('rejects a company that does not belong to the role (negative case)', async () => {
      const h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({
          roles: [
            {
              id: 11n,
              role: 'driver',
              status: 'active',
              companyId: 5n,
              adminLevel: null,
            },
          ],
        }),
      )
      h.prisma.company.findFirst.mockResolvedValueOnce({ id: 6n, publicId: 'CO2' })
      await expect(
        h.service.switchRole({
          userId: 1n,
          sessionId: 100n,
          role: 'driver',
          companyId: 'CO2',
        }),
      ).rejects.toThrow(/does not belong/)
    })

    it('rejects when the role links to a deleted company', async () => {
      const h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({
          roles: [
            {
              id: 11n,
              role: 'driver',
              status: 'active',
              companyId: 5n,
              adminLevel: null,
            },
          ],
        }),
      )
      h.prisma.company.findFirst.mockResolvedValueOnce(null)
      await expect(
        h.service.switchRole({ userId: 1n, sessionId: 100n, role: 'driver' }),
      ).rejects.toThrow(/broken/)
    })
  })

  describe('provisionTotp', () => {
    it('stores an encrypted secret for a superadmin', async () => {
      const h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(
        makeUser({
          roles: [
            {
              id: 30n,
              role: 'superadmin',
              status: 'active',
              companyId: null,
              adminLevel: 'super',
            },
          ],
        }),
      )
      const result = await h.service.provisionTotp('U1')
      expect(result.otpauthUrl).toContain('otpauth://')
      expect(h.prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { totpSecretEnc: expect.any(String) },
        }),
      )
    })

    it('rejects non-admin accounts (negative case)', async () => {
      const h = makeHarness()
      h.prisma.user.findUnique.mockResolvedValue(makeUser({ roles: [] }))
      await expect(h.service.provisionTotp('U1')).rejects.toThrow(ForbiddenException)
    })
  })
})
