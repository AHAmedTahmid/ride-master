import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateSurchargeDto, UpdateSurchargeDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { SurchargesService } from './surcharges.service'

function surchargeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 50n,
    publicId: 'SC1',
    companyId: 10n,
    name: 'Night Surge',
    amountLaari: 1000n,
    percentBps: null,
    timeFrom: new Date('1970-01-01T22:00:00.000Z'),
    timeTo: new Date('1970-01-01T05:00:00.000Z'),
    active: true,
    createdAt: new Date('2026-01-01'),
    company: { publicId: 'C1', name: 'Test Co' },
    ...overrides,
  }
}

function makeHarness(opts: { companyStatus?: string } = {}) {
  const prisma = {
    company: {
      findUnique: vi.fn(async () => ({ id: 10n, status: opts.companyStatus ?? 'approved' })),
    },
    surcharge: {
      findMany: vi.fn(async () => [surchargeRow()]),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...surchargeRow(),
        ...args.data,
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...surchargeRow(),
        ...args.data,
      })),
      delete: vi.fn(async () => surchargeRow()),
    },
  }
  const policy = { resolveTargetCompanyId: vi.fn(async () => 10n) }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new SurchargesService(prisma as never, policy as never, audit as never)
  return { service, prisma, policy, audit }
}

function ownerAuth(): AuthContext {
  return {
    userId: 5n,
    userPublicId: 'U',
    fullName: 'Owner',
    phone: '+9607770001',
    language: 'en',
    sessionId: 9n,
    sessionPublicId: 'S',
    roles: ['company_owner'],
    activeRole: 'company_owner',
    companyPublicId: 'C1',
    companyId: 10n,
  }
}

const SURCHARGE: CreateSurchargeDto = {
  name: 'Night Surge',
  amountLaari: 1000,
  timeFrom: '22:00',
  timeTo: '05:00',
}

describe('SurchargesService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists surcharges with formatted time and string amounts', async () => {
    const h = makeHarness()
    const res = await h.service.list(ownerAuth(), 'C1')

    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      publicId: 'SC1',
      name: 'Night Surge',
      amountLaari: '1000',
      percentBps: null,
      timeFrom: '22:00',
      timeTo: '05:00',
      active: true,
    })
  })

  it('rejects creation for an unapproved company', async () => {
    const h = makeHarness({ companyStatus: 'pending' })
    await expect(h.service.create(ownerAuth(), SURCHARGE)).rejects.toThrow(ConflictException)
  })

  it('creates a surcharge and writes a SURCHARGE_CREATED audit entry', async () => {
    const h = makeHarness()
    const res = await h.service.create(ownerAuth(), SURCHARGE)

    expect(h.prisma.surcharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 10n,
          name: 'Night Surge',
          amountLaari: 1000n,
          percentBps: null,
          active: true,
        }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SURCHARGE_CREATED', entityType: 'surcharge' }),
    )
    expect(res.amountLaari).toBe('1000')
  })

  it('maps missing or foreign surcharges to 404/403 on update', async () => {
    const h = makeHarness()
    await expect(h.service.update(ownerAuth(), 'NOPE', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    )

    h.prisma.surcharge.findFirst.mockResolvedValueOnce(surchargeRow({ companyId: 99n }))
    await expect(h.service.update(ownerAuth(), 'SC1', { name: 'New' })).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('updates surcharge attributes, clears old type when switching, and audits', async () => {
    const h = makeHarness()
    h.prisma.surcharge.findFirst.mockResolvedValueOnce(surchargeRow())
    const dto: UpdateSurchargeDto = { percentBps: 1500 } // switch from amountLaari to percentBps
    const res = await h.service.update(ownerAuth(), 'SC1', dto)

    expect(h.prisma.surcharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountLaari: null,
          percentBps: 1500,
        }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SURCHARGE_UPDATED' }),
    )
    expect(res.percentBps).toBe(1500)
    expect(res.amountLaari).toBeNull()
  })

  it('enforces timeFrom and timeTo pairing on update', async () => {
    const h = makeHarness()
    h.prisma.surcharge.findFirst.mockResolvedValueOnce(surchargeRow())

    await expect(h.service.update(ownerAuth(), 'SC1', { timeTo: null })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('deletes a surcharge and writes a SURCHARGE_DELETED audit entry', async () => {
    const h = makeHarness()
    h.prisma.surcharge.findFirst.mockResolvedValueOnce(surchargeRow())
    const res = await h.service.remove(ownerAuth(), 'SC1')

    expect(h.prisma.surcharge.delete).toHaveBeenCalledWith({ where: { id: 50n } })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SURCHARGE_DELETED', entityType: 'surcharge' }),
    )
    expect(res).toEqual({ publicId: 'SC1', deleted: true })
  })
})
