import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateVehicleDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { VehiclesService } from './vehicles.service'

function vehicleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 20n,
    publicId: 'V1',
    companyId: 10n,
    vehicleTypeId: 5n,
    plateNumber: 'BG-1101',
    make: 'Toyota',
    model: 'Axio',
    year: 2021,
    colour: 'White',
    insuranceExpiry: new Date('2027-06-30'),
    status: 'active',
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    vehicleType: { publicId: 'VT1', name: 'Sedan', seats: 4, luggageCapacity: 2 },
    assignments: [],
    ...overrides,
  }
}

function makeHarness(overrides: { companyType?: string; individualCount?: number } = {}) {
  const prisma = {
    company: {
      findFirst: vi.fn(async () => ({
        id: 10n,
        publicId: 'C1',
        type: overrides.companyType ?? 'company',
      })),
    },
    vehicleType: { findUnique: vi.fn(async () => ({ id: 5n })) },
    vehicle: {
      count: vi.fn(async () => overrides.individualCount ?? 0),
      findMany: vi.fn(async () => [vehicleRow()]),
      findFirst: vi.fn(async () => vehicleRow()),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...vehicleRow(),
        ...args.data,
        plateNumber: args.data.plateNumber ?? 'BG-1101',
        insuranceExpiry:
          args.data.insuranceExpiry instanceof Date
            ? args.data.insuranceExpiry
            : new Date('2027-06-30'),
        vehicleType: { publicId: 'VT1', name: 'Sedan', seats: 4, luggageCapacity: 2 },
        assignments: [],
      })),
      update: vi.fn(async () => vehicleRow()),
    },
    driverVehicleAssignment: { findFirst: vi.fn(async () => null) },
  }
  const policy = { resolveTargetCompanyId: vi.fn(async () => 10n) }
  const audit = { log: vi.fn(async () => undefined) }
  const settings = { getNumber: vi.fn(async () => 3) }
  const service = new VehiclesService(
    prisma as never,
    policy as never,
    audit as never,
    settings as never,
  )
  return { service, prisma, policy, audit, settings }
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

const VEHICLE: CreateVehicleDto = {
  vehicleTypeId: 'VT1',
  plateNumber: 'BG-9999',
  make: 'Honda',
  model: 'Vezel',
  year: 2022,
  colour: 'Black',
  insuranceExpiry: '2027-12-31',
}

describe('VehiclesService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the fleet with type and open assignment info', async () => {
    const h = makeHarness()
    const rows = await h.service.list(ownerAuth())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      publicId: 'V1',
      plateNumber: 'BG-1101',
      assignedDriver: null,
    })
    expect(h.policy.resolveTargetCompanyId).toHaveBeenCalledWith(ownerAuth(), undefined)
  })

  it('creates a vehicle and audits it', async () => {
    const h = makeHarness()
    const res = await h.service.create(ownerAuth(), VEHICLE)
    expect(res.plateNumber).toBe('BG-9999')
    expect(h.prisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'VEHICLE_CREATED' }))
  })

  it('individual operators are capped at the platform vehicle limit', async () => {
    const h = makeHarness({ companyType: 'individual', individualCount: 3 })
    await expect(h.service.create(ownerAuth(), VEHICLE)).rejects.toThrow(/limited to 3 vehicles/)
    expect(h.prisma.vehicle.create).not.toHaveBeenCalled()
    expect(h.settings.getNumber).toHaveBeenCalledWith('individual_vehicle_limit')
  })

  it('individuals below the limit may add vehicles', async () => {
    const h = makeHarness({ companyType: 'individual', individualCount: 2 })
    await expect(h.service.create(ownerAuth(), VEHICLE)).resolves.toMatchObject({
      plateNumber: 'BG-9999',
    })
  })

  it('rejects an unknown vehicle type', async () => {
    const h = makeHarness()
    ;(h.prisma.vehicleType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(
      h.service.create(ownerAuth(), { ...VEHICLE, vehicleTypeId: 'NOPE' }),
    ).rejects.toThrow(BadRequestException)
  })

  it('maps duplicate plates to a conflict', async () => {
    const h = makeHarness()
    ;(h.prisma.vehicle.create as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 'P2002' })
    await expect(h.service.create(ownerAuth(), VEHICLE)).rejects.toThrow(ConflictException)
  })

  it('forbids updating another company vehicle (negative case)', async () => {
    const h = makeHarness()
    ;(h.prisma.vehicle.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      vehicleRow({ companyId: 99n }),
    )
    await expect(h.service.update(ownerAuth(), 'V1', { colour: 'Red' })).rejects.toThrow(
      ForbiddenException,
    )
    expect(h.prisma.vehicle.update).not.toHaveBeenCalled()
  })

  it('updates an own vehicle and audits old/new values', async () => {
    const h = makeHarness()
    await h.service.update(ownerAuth(), 'V1', { colour: 'Red' })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VEHICLE_UPDATED',
        newValue: expect.objectContaining({ status: 'active' }),
      }),
    )
  })

  it('refuses to delete a vehicle with an open assignment', async () => {
    const h = makeHarness()
    ;(h.prisma.driverVehicleAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicId: 'A1',
    })
    await expect(h.service.remove(ownerAuth(), 'V1')).rejects.toThrow(/active driver assignment/)
    expect(h.prisma.vehicle.update).not.toHaveBeenCalled()
  })

  it('soft-deletes an unassigned vehicle and audits it', async () => {
    const h = makeHarness()
    const res = await h.service.remove(ownerAuth(), 'V1')
    expect(res.deleted).toBe(true)
    expect(h.prisma.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20n },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'VEHICLE_DELETED' }))
  })
})
