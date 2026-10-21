import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../decorators/auth.decorators'
import { PolicyService } from './policy.service'

function makeAuth(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: 1n,
    userPublicId: 'U1',
    fullName: 'Test',
    phone: '+9607712345',
    language: 'en',
    sessionId: 1n,
    sessionPublicId: 'S1',
    roles: ['rider'],
    activeRole: 'rider',
    ...overrides,
  }
}

describe('PolicyService', () => {
  const policy = new PolicyService()

  describe('requireCompanyScope', () => {
    it('lets superadmins touch any company', () => {
      const auth = makeAuth({ activeRole: 'superadmin', roles: ['superadmin'] })
      expect(() => policy.requireCompanyScope(auth, 'ANY')).not.toThrow()
    })

    it('lets a company_owner act inside their own company', () => {
      const auth = makeAuth({
        activeRole: 'company_owner',
        roles: ['company_owner'],
        companyPublicId: 'CO1',
      })
      expect(() => policy.requireCompanyScope(auth, 'CO1')).not.toThrow()
    })

    it('blocks a company_owner from another company (negative case)', () => {
      const auth = makeAuth({
        activeRole: 'company_owner',
        roles: ['company_owner'],
        companyPublicId: 'CO1',
      })
      expect(() => policy.requireCompanyScope(auth, 'CO2')).toThrow(ForbiddenException)
    })

    it('lets a driver act inside their own company', () => {
      const auth = makeAuth({
        activeRole: 'driver',
        roles: ['driver'],
        companyPublicId: 'CO1',
      })
      expect(() => policy.requireCompanyScope(auth, 'CO1')).not.toThrow()
    })

    it('blocks a driver from another company (negative case)', () => {
      const auth = makeAuth({
        activeRole: 'driver',
        roles: ['driver'],
        companyPublicId: 'CO1',
      })
      expect(() => policy.requireCompanyScope(auth, 'CO2')).toThrow(ForbiddenException)
    })

    it('blocks a rider entirely (negative case)', () => {
      const auth = makeAuth({ activeRole: 'rider', roles: ['rider'] })
      expect(() => policy.requireCompanyScope(auth, 'CO1')).toThrow(/role has no company scope/)
    })

    it('blocks a company-linked actor whose session lost the company', () => {
      const auth = makeAuth({ activeRole: 'company_owner', roles: ['company_owner'] })
      expect(() => policy.requireCompanyScope(auth, 'CO1')).toThrow(ForbiddenException)
    })
  })

  describe('resolveCompanyId', () => {
    it('returns the trusted session companyId', () => {
      expect(policy.resolveCompanyId(makeAuth({ companyId: 42n }))).toBe(42n)
    })

    it('throws when the actor has no company', () => {
      expect(() => policy.resolveCompanyId(makeAuth({}))).toThrow(/not linked to a company/)
    })
  })

  describe('requireSelf', () => {
    it('lets a user act on their own record', () => {
      expect(() => policy.requireSelf(makeAuth({ userPublicId: 'U1' }), 'U1')).not.toThrow()
    })

    it('blocks acting on another user (negative case)', () => {
      expect(() => policy.requireSelf(makeAuth({ userPublicId: 'U1' }), 'U2')).toThrow(
        ForbiddenException,
      )
    })

    it('superadmin bypasses self-check', () => {
      const auth = makeAuth({ activeRole: 'superadmin', userPublicId: 'U1' })
      expect(() => policy.requireSelf(auth, 'U2')).not.toThrow()
    })
  })

  describe('requireSuperadmin', () => {
    it('lets any superadmin through', () => {
      expect(() => policy.requireSuperadmin(makeAuth({ activeRole: 'superadmin' }))).not.toThrow()
    })

    it('blocks every other role (negative cases)', () => {
      for (const role of ['rider', 'driver', 'company_owner'] as const) {
        expect(() => policy.requireSuperadmin(makeAuth({ activeRole: role }))).toThrow(
          ForbiddenException,
        )
      }
    })
  })

  describe('resolveTargetCompanyId', () => {
    function withPrisma(company: { id: bigint } | null) {
      const prisma = { company: { findFirst: vi.fn(async () => company) } }
      return { policy: new PolicyService(prisma as never), prisma }
    }

    it('superadmin must name the company explicitly (no default)', async () => {
      const { policy } = withPrisma({ id: 42n })
      await expect(
        policy.resolveTargetCompanyId(makeAuth({ activeRole: 'superadmin' })),
      ).rejects.toThrow(BadRequestException)
    })

    it('superadmin resolves the named company', async () => {
      const { policy, prisma } = withPrisma({ id: 42n })
      await expect(
        policy.resolveTargetCompanyId(makeAuth({ activeRole: 'superadmin' }), 'CO1'),
      ).resolves.toBe(42n)
      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { publicId: 'CO1', deletedAt: null } }),
      )
    })

    it('superadmin gets 404 for an unknown company', async () => {
      const { policy } = withPrisma(null)
      await expect(
        policy.resolveTargetCompanyId(makeAuth({ activeRole: 'superadmin' }), 'NOPE'),
      ).rejects.toThrow(NotFoundException)
    })

    it('owner gets their own company without a query param', async () => {
      const { policy } = withPrisma(null)
      await expect(
        policy.resolveTargetCompanyId(
          makeAuth({
            activeRole: 'company_owner',
            roles: ['company_owner'],
            companyId: 7n,
            companyPublicId: 'CO1',
          }),
        ),
      ).resolves.toBe(7n)
    })

    it('owner passing a foreign company public id is forbidden (negative case)', async () => {
      const { policy } = withPrisma(null)
      await expect(
        policy.resolveTargetCompanyId(
          makeAuth({
            activeRole: 'company_owner',
            roles: ['company_owner'],
            companyId: 7n,
            companyPublicId: 'CO1',
          }),
          'OTHER',
        ),
      ).rejects.toThrow(ForbiddenException)
    })

    it('owner matching their own public id is allowed', async () => {
      const { policy } = withPrisma(null)
      await expect(
        policy.resolveTargetCompanyId(
          makeAuth({
            activeRole: 'company_owner',
            roles: ['company_owner'],
            companyId: 7n,
            companyPublicId: 'CO1',
          }),
          'CO1',
        ),
      ).resolves.toBe(7n)
    })

    it('actor without a company link is forbidden', async () => {
      const { policy } = withPrisma(null)
      await expect(
        policy.resolveTargetCompanyId(makeAuth({ activeRole: 'driver', roles: ['driver'] })),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
