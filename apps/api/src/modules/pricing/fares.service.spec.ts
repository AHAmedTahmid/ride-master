import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateFareDto, UpdateFareDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { FaresService } from './fares.service'

function fareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 40n,
    publicId: 'F1',
    companyId: 10n,
    vehicleTypeId: 5n,
    fromAreaId: 1n,
    toAreaId: 2n,
    priceLaari: 5000n,
    active: true,
    validFrom: null,
    validTo: null,
    createdAt: new Date('2026-01-01'),
    fromArea: { publicId: 'A1', nameEn: 'Male', nameDv: 'Malé' },
    toArea: { publicId: 'A2', nameEn: 'Hulhumale', nameDv: 'Hulhumalé' },
    vehicleType: { publicId: 'VT1', name: 'Car', seats: 4 },
    history: [],
    ...overrides,
  }
}

function makeHarness(opts: { companyStatus?: string } = {}) {
  const prisma = {
    company: {
      findUnique: vi.fn(async () => ({ id: 10n, status: opts.companyStatus ?? 'approved' })),
    },
    area: {
      findUnique: vi.fn(async (args: { where: { publicId: string } }) => {
        const ids: Record<string, bigint> = { A1: 1n, A2: 2n }
        const id = ids[args.where.publicId]
        return id === undefined ? null : { id }
      }),
    },
    vehicleType: {
      findUnique: vi.fn(async (args: { where: { publicId: string } }) =>
        args.where.publicId === 'VT1' ? { id: 5n } : null,
      ),
    },
    suggestedFare: {
      findUnique: vi.fn(async () => null),
    },
    fare: {
      findMany: vi.fn(async () => [fareRow()]),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...fareRow(),
        ...args.data,
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...fareRow(),
        ...args.data,
      })),
      delete: vi.fn(async () => fareRow()),
    },
    fareHistory: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  const policy = { resolveTargetCompanyId: vi.fn(async () => 10n) }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new FaresService(prisma as never, policy as never, audit as never)
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

const FARE: CreateFareDto = {
  vehicleTypeId: 'VT1',
  fromAreaId: 'A1',
  toAreaId: 'A2',
  priceLaari: 5000,
}

describe('FaresService', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── list ─────────────────────────────────────────────────────────────────────

  it('lists company fares as public views with string prices', async () => {
    const h = makeHarness()
    const res = await h.service.list(ownerAuth(), 'C1')

    expect(h.policy.resolveTargetCompanyId).toHaveBeenCalledWith(expect.anything(), 'C1')
    expect(h.prisma.fare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 10n } }),
    )
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ publicId: 'F1', priceLaari: '5000', active: true })
    expect(res[0]).toHaveProperty('fromArea.nameEn', 'Male')
  })

  // ── create ───────────────────────────────────────────────────────────────────

  it('rejects fare creation for a company that is not approved', async () => {
    const h = makeHarness({ companyStatus: 'pending' })
    await expect(h.service.create(ownerAuth(), FARE)).rejects.toThrow(ConflictException)
  })

  it('rejects a route whose from and to areas are identical', async () => {
    const h = makeHarness()
    await expect(h.service.create(ownerAuth(), { ...FARE, toAreaId: 'A1' })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('rejects unknown areas and unknown vehicle types', async () => {
    const h = makeHarness()
    await expect(h.service.create(ownerAuth(), { ...FARE, fromAreaId: 'NOPE' })).rejects.toThrow(
      BadRequestException,
    )
    await expect(h.service.create(ownerAuth(), { ...FARE, vehicleTypeId: 'NOPE' })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('maps a duplicate route to 409', async () => {
    const h = makeHarness()
    h.prisma.fare.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 'P2002' }),
    )
    await expect(h.service.create(ownerAuth(), FARE)).rejects.toThrow(ConflictException)
  })

  it('creates a fare and writes a FARE_CREATED audit entry', async () => {
    const h = makeHarness()
    const res = await h.service.create(ownerAuth(), {
      ...FARE,
      validFrom: '2026-06-01T00:00:00.000Z',
    })

    expect(h.prisma.fare.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 10n,
          priceLaari: 5000n,
          active: true,
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
        }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FARE_CREATED', entityType: 'fare' }),
    )
    expect(res).toMatchObject({ priceLaari: '5000', active: true })
  })

  // ── from-suggested ───────────────────────────────────────────────────────────

  it('imports a suggested fare into the company', async () => {
    const h = makeHarness()
    h.prisma.suggestedFare.findUnique.mockResolvedValueOnce({
      fromAreaId: 1n,
      toAreaId: 2n,
      vehicleTypeId: 5n,
      priceLaari: 7500n,
    })
    const res = await h.service.fromSuggested(ownerAuth(), { suggestedFarePublicId: 'SF1' })

    expect(h.prisma.fare.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 10n,
          priceLaari: 7500n,
          active: true,
        }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FARE_CREATED',
        newValue: expect.objectContaining({ source: 'suggested' }),
      }),
    )
    expect(res.priceLaari).toBe('7500')
  })

  it('maps a missing suggested fare to 404 and a duplicate route to 409', async () => {
    const h = makeHarness()
    await expect(
      h.service.fromSuggested(ownerAuth(), { suggestedFarePublicId: 'NOPE' }),
    ).rejects.toThrow(NotFoundException)

    h.prisma.suggestedFare.findUnique.mockResolvedValueOnce({
      fromAreaId: 1n,
      toAreaId: 2n,
      vehicleTypeId: 5n,
      priceLaari: 7500n,
    })
    h.prisma.fare.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 'P2002' }),
    )
    await expect(
      h.service.fromSuggested(ownerAuth(), { suggestedFarePublicId: 'SF1' }),
    ).rejects.toThrow(ConflictException)
  })

  // ── update ───────────────────────────────────────────────────────────────────

  it('maps a missing or foreign fare to 404/403 on update', async () => {
    const h = makeHarness()
    await expect(h.service.update(ownerAuth(), 'NOPE', { priceLaari: 9000 })).rejects.toThrow(
      NotFoundException,
    )

    h.prisma.fare.findFirst.mockResolvedValueOnce(fareRow({ companyId: 99n }))
    await expect(h.service.update(ownerAuth(), 'F1', { priceLaari: 9000 })).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('records fare history on price change inside the transaction', async () => {
    const h = makeHarness()
    h.prisma.fare.findFirst.mockResolvedValueOnce(fareRow())
    const dto: UpdateFareDto = { priceLaari: 9000 }
    const res = await h.service.update(ownerAuth(), 'F1', dto)

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(h.prisma.fareHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldPriceLaari: 5000n,
          newPriceLaari: 9000n,
          changedBy: 5n,
        }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FARE_UPDATED',
        oldValue: expect.objectContaining({ priceLaari: '5000' }),
        newValue: expect.objectContaining({ priceLaari: '9000' }),
      }),
    )
    expect(res.priceLaari).toBe('9000')
  })

  it('toggles active without writing history when price is unchanged', async () => {
    const h = makeHarness()
    h.prisma.fare.findFirst.mockResolvedValueOnce(fareRow())
    await h.service.update(ownerAuth(), 'F1', { active: false })

    expect(h.prisma.fareHistory.create).not.toHaveBeenCalled()
    expect(h.prisma.fare.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    )
  })

  // ── remove ───────────────────────────────────────────────────────────────────

  it('maps a missing or foreign fare to 404/403 on remove', async () => {
    const h = makeHarness()
    await expect(h.service.remove(ownerAuth(), 'NOPE')).rejects.toThrow(NotFoundException)

    h.prisma.fare.findFirst.mockResolvedValueOnce(fareRow({ companyId: 99n }))
    await expect(h.service.remove(ownerAuth(), 'F1')).rejects.toThrow(ForbiddenException)
  })

  it('refuses to delete a fare that has price history', async () => {
    const h = makeHarness()
    h.prisma.fare.findFirst.mockResolvedValueOnce(
      fareRow({
        history: [
          { publicId: 'FH1', oldPriceLaari: 4000n, newPriceLaari: 5000n, changedAt: new Date() },
        ],
      }),
    )
    await expect(h.service.remove(ownerAuth(), 'F1')).rejects.toThrow(ConflictException)
    expect(h.prisma.fare.delete).not.toHaveBeenCalled()
  })

  it('deletes a history-less fare and writes a FARE_DELETED audit entry', async () => {
    const h = makeHarness()
    h.prisma.fare.findFirst.mockResolvedValueOnce(fareRow())
    const res = await h.service.remove(ownerAuth(), 'F1')

    expect(h.prisma.fare.delete).toHaveBeenCalledWith({ where: { id: 40n } })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FARE_DELETED', entityType: 'fare' }),
    )
    expect(res).toEqual({ publicId: 'F1', deleted: true })
  })
})
