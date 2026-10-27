import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { SuggestedFaresService } from './suggested-fares.service'

function fareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7n,
    publicId: 'SF1',
    fromAreaId: 1n,
    toAreaId: 2n,
    vehicleTypeId: 5n,
    priceLaari: 15000n,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    fromArea: { publicId: 'A1', nameEn: 'Mal\u00e9', nameDv: '\u074b\u073f\u072a\u074a' },
    toArea: { publicId: 'A2', nameEn: 'Hulhumale', nameDv: '\u0747\u073f\u0737\u074d\u0728\u073a' },
    vehicleType: { publicId: 'VT1', name: 'Sedan', seats: 4 },
    ...overrides,
  }
}

function makeHarness(row: unknown = fareRow()) {
  const prisma = {
    area: {
      findUnique: vi.fn(async (args: { where: { publicId: string } }) => {
        if (args.where.publicId.startsWith('A'))
          return { id: args.where.publicId === 'A1' ? 1n : 2n }
        return null
      }),
    },
    vehicleType: { findUnique: vi.fn(async () => ({ id: 5n })) },
    suggestedFare: {
      findMany: vi.fn(async () => [row]),
      findUnique: vi.fn(async () => row),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...fareRow(),
        ...args.data,
      })),
      update: vi.fn(async () => row),
      delete: vi.fn(async () => row),
    },
  }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new SuggestedFaresService(prisma as never, audit as never)
  return { service, prisma, audit }
}

function superAuth(): AuthContext {
  return {
    userId: 9n,
    userPublicId: 'U9',
    fullName: 'Admin',
    phone: '+9609990001',
    language: 'en',
    sessionId: 3n,
    sessionPublicId: 'S3',
    roles: ['superadmin'],
    activeRole: 'superadmin',
    adminLevel: 'super',
  }
}

const DTO = { fromAreaId: 'A1', toAreaId: 'A2', vehicleTypeId: 'VT1', priceLaari: 20000 }

describe('SuggestedFaresService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists suggested fares with resolved names and string prices', async () => {
    const h = makeHarness()
    const rows = await h.service.list()
    expect(rows[0]).toMatchObject({
      publicId: 'SF1',
      priceLaari: '15000',
      fromArea: { publicId: 'A1' },
      vehicleType: { name: 'Sedan' },
    })
  })

  it('creates a suggested fare from resolved refs and audits it', async () => {
    const h = makeHarness()
    const result = await h.service.create(superAuth(), DTO)
    expect(h.prisma.suggestedFare.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromAreaId: 1n,
          toAreaId: 2n,
          vehicleTypeId: 5n,
          priceLaari: 20000n,
        }),
      }),
    )
    expect(result).toMatchObject({ priceLaari: '20000', vehicleType: { name: 'Sedan' } })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUGGESTED_FARE_CREATED',
        newValue: expect.objectContaining({ priceLaari: 20000 }),
      }),
    )
  })

  it('400s on unknown area or vehicle type', async () => {
    const h = makeHarness()
    await expect(h.service.create(superAuth(), { ...DTO, toAreaId: 'UNKNOWN' })).rejects.toThrow(
      BadRequestException,
    )

    const h2 = makeHarness()
    ;(h2.prisma.vehicleType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(h2.service.create(superAuth(), DTO)).rejects.toThrow('Unknown vehicle type')
  })

  it('400s when from and to resolve to the same area', async () => {
    const h = makeHarness()
    await expect(h.service.create(superAuth(), { ...DTO, toAreaId: 'A1' })).rejects.toThrow(
      'must differ',
    )
  })

  it('409s on duplicate route/type (unique violation)', async () => {
    const h = makeHarness()
    ;(h.prisma.suggestedFare.create as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: 'P2002',
    })
    await expect(h.service.create(superAuth(), DTO)).rejects.toThrow(ConflictException)
  })

  it('updates the price and audits old/new values', async () => {
    const h = makeHarness()
    const result = await h.service.update(superAuth(), 'SF1', { priceLaari: 18000 })
    expect(h.prisma.suggestedFare.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { priceLaari: 18000n } }),
    )
    expect(result).toMatchObject({ publicId: 'SF1' })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUGGESTED_FARE_UPDATED',
        oldValue: { priceLaari: '15000' },
        newValue: { priceLaari: 18000 },
      }),
    )
  })

  it('404s on update/delete of an unknown fare', async () => {
    const h = makeHarness(null)
    await expect(h.service.update(superAuth(), 'NOPE', { priceLaari: 1 })).rejects.toThrow(
      NotFoundException,
    )
    await expect(h.service.remove(superAuth(), 'NOPE')).rejects.toThrow(NotFoundException)
  })

  it('deletes and audits', async () => {
    const h = makeHarness()
    const result = await h.service.remove(superAuth(), 'SF1')
    expect(result).toEqual({ publicId: 'SF1', deleted: true })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUGGESTED_FARE_DELETED' }),
    )
  })
})
