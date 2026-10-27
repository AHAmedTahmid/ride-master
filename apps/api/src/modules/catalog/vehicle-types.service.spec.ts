import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { VehicleTypesService } from './vehicle-types.service'

function typeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    publicId: 'VT1',
    name: 'Sedan',
    seats: 4,
    luggageCapacity: 2,
    sortOrder: 1,
    createdAt: new Date('2026-01-01'),
    _count: { vehicles: 0, fares: 0, suggestedFares: 0 },
    ...overrides,
  }
}

function makeHarness(row: unknown = typeRow()) {
  const prisma = {
    vehicleType: {
      findMany: vi.fn(async () => [row]),
      findUnique: vi.fn(async () => row),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...typeRow(),
        ...args.data,
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...row, ...args.data })),
      delete: vi.fn(async () => row),
    },
    vehicle: { count: vi.fn(async () => 0) },
    fare: { count: vi.fn(async () => 0) },
    suggestedFare: { count: vi.fn(async () => 0) },
    booking: { count: vi.fn(async () => 0) },
  }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new VehicleTypesService(prisma as never, audit as never)
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

describe('VehicleTypesService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists vehicle types with usage counts', async () => {
    const h = makeHarness(typeRow({ _count: { vehicles: 3, fares: 2, suggestedFares: 1 } }))
    const rows = await h.service.list()
    expect(rows[0]).toMatchObject({
      publicId: 'VT1',
      name: 'Sedan',
      counts: { vehicles: 3, fares: 2, suggestedFares: 1 },
    })
  })

  it('creates a vehicle type and audits it', async () => {
    const h = makeHarness()
    const result = await h.service.create(superAuth(), {
      name: 'SUV',
      seats: 7,
      luggageCapacity: 4,
      sortOrder: 2,
    })
    expect(result).toMatchObject({ name: 'SUV', seats: 7 })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VEHICLE_TYPE_CREATED', entityType: 'vehicle_type' }),
    )
  })

  it('updates only provided fields and audits old/new values', async () => {
    const h = makeHarness()
    await h.service.update(superAuth(), 'VT1', { seats: 5 })
    expect(h.prisma.vehicleType.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { seats: 5 } }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VEHICLE_TYPE_UPDATED',
        oldValue: expect.objectContaining({ name: 'Sedan', seats: 4 }),
        newValue: expect.objectContaining({ name: 'Sedan', seats: 5 }),
      }),
    )
  })

  it('404s on update of an unknown type', async () => {
    const h = makeHarness(null)
    await expect(h.service.update(superAuth(), 'NOPE', { seats: 5 })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('blocks delete while vehicles or fares reference the type', async () => {
    const withVehicles = makeHarness()
    withVehicles.prisma.vehicle.count = vi.fn(async () => 2)
    await expect(withVehicles.service.remove(superAuth(), 'VT1')).rejects.toThrow(ConflictException)

    const withFares = makeHarness()
    withFares.prisma.fare.count = vi.fn(async () => 1)
    await expect(withFares.service.remove(superAuth(), 'VT1')).rejects.toThrow(ConflictException)
  })

  it('deletes an unreferenced type and audits it', async () => {
    const h = makeHarness()
    const result = await h.service.remove(superAuth(), 'VT1')
    expect(result).toEqual({ publicId: 'VT1', deleted: true })
    expect(h.prisma.vehicleType.delete).toHaveBeenCalled()
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VEHICLE_TYPE_DELETED' }),
    )
  })

  it('404s on delete of an unknown type', async () => {
    const h = makeHarness(null)
    await expect(h.service.remove(superAuth(), 'NOPE')).rejects.toThrow(NotFoundException)
  })
})
