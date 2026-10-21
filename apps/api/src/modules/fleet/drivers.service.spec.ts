import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateAssignmentDto, CreateDriverDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { DriversService } from './drivers.service'

function driverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 30n,
    publicId: 'D1',
    companyId: 10n,
    userId: 5n,
    licenceNumber: 'DL-MV-1000',
    licenceExpiry: new Date('2028-12-31'),
    status: 'active',
    ratingAvg: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    user: { publicId: 'U-D1', fullName: 'Driver One', phone: '+9609992001' },
    assignments: [],
    ...overrides,
  }
}

function makeHarness(overrides: { companyStatus?: string } = {}) {
  const prisma = {
    company: {
      findFirst: vi.fn(async () => ({
        id: 10n,
        publicId: 'C1',
        status: overrides.companyStatus ?? 'approved',
      })),
      findUnique: vi.fn(async () => ({ id: 10n, publicId: 'C1', status: 'approved' })),
    },
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 5n,
        publicId: 'U-D1',
        ...args.data,
      })),
      update: vi.fn(async () => ({})),
    },
    userRole: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    driver: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...driverRow(),
        ...args.data,
      })),
      findUniqueOrThrow: vi.fn(async () => driverRow()),
      update: vi.fn(async () => driverRow()),
    },
    vehicle: { findUnique: vi.fn(async () => null) },
    driverStatus: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ state: 'offline' })),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    driverVehicleAssignment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        publicId: 'A1',
        ...args.data,
        vehicle: { publicId: 'V1', plateNumber: 'BG-1101' },
        driver: { publicId: 'D1', user: { fullName: 'Driver One' } },
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  const policy = { resolveTargetCompanyId: vi.fn(async () => 10n) }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new DriversService(prisma as never, policy as never, audit as never)
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

const DRIVER: CreateDriverDto = {
  phone: '+9609992002',
  fullName: 'Driver Two',
  licenceNumber: 'DL-MV-2000',
  licenceExpiry: '2028-12-31',
}

describe('DriversService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a driver under the company account', async () => {
    const h = makeHarness()
    const res = await h.service.create(ownerAuth(), DRIVER)
    expect(res.licenceNumber).toBe('DL-MV-2000')
    expect(res.status).toBe('active')
    expect(h.prisma.driver.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DRIVER_CREATED' }))
  })

  it('marks the driver pending until the company is approved', async () => {
    const h = makeHarness({ companyStatus: 'pending' })
    await h.service.create(ownerAuth(), DRIVER)
    const createCall = (h.prisma.driver.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createCall.data.status).toBe('pending')
  })

  it('refuses a driver who already drives for another company (negative case)', async () => {
    const h = makeHarness()
    ;(h.prisma.userRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { companyId: 99n },
    ])
    await expect(h.service.create(ownerAuth(), DRIVER)).rejects.toThrow(/another company/)
    expect(h.prisma.driver.create).not.toHaveBeenCalled()
  })

  it('refuses a driver who is already in this company', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    await expect(h.service.create(ownerAuth(), DRIVER)).rejects.toThrow(/already a driver/)
  })

  it('refuses a malformed phone with 400', async () => {
    const h = makeHarness()
    await expect(h.service.create(ownerAuth(), { ...DRIVER, phone: 'bad' })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('suspends a driver and audits it', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    await h.service.update(ownerAuth(), 'D1', { status: 'suspended' })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DRIVER_SUSPENDED' }),
    )
  })

  it('blocks suspending a driver who is on an active trip', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    ;(h.prisma.driverStatus.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: 'on_trip',
    })
    await expect(h.service.update(ownerAuth(), 'D1', { status: 'suspended' })).rejects.toThrow(
      /active trip/,
    )
  })

  it('forbids activating a driver whose company is not approved', async () => {
    const h = makeHarness({ companyStatus: 'pending' })
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    ;(h.prisma.company.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10n,
      publicId: 'C1',
      status: 'pending',
    })
    await expect(h.service.update(ownerAuth(), 'D1', { status: 'active' })).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('removes a driver, closes assignments and audits', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    const res = await h.service.remove(ownerAuth(), 'D1')
    expect(res.removed).toBe(true)
    expect(h.prisma.driver.update).toHaveBeenCalled()
    expect(h.prisma.userRole.updateMany).toHaveBeenCalled()
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DRIVER_DELETED' }))
  })

  it('blocks removing a driver on an active trip', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    ;(h.prisma.driverStatus.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: 'on_trip',
    })
    await expect(h.service.remove(ownerAuth(), 'D1')).rejects.toThrow(/active trip/)
  })

  it('assigns an open vehicle and audits', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    ;(h.prisma.vehicle.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 20n,
      companyId: 10n,
      status: 'active',
    })
    const res = await h.service.assign(ownerAuth(), 'D1', {
      vehiclePublicId: 'V1',
    } as CreateAssignmentDto)
    expect(res.publicId).toMatch(/^[0-9A-Z]{26}$/)
    expect(h.prisma.driverStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { driverId: 30n },
        update: { currentVehicleId: 20n },
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DRIVER_ASSIGNED' }))
  })

  it('rejects assignment conflicts: missing vehicle, foreign vehicle, retired, taken', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    await expect(h.service.assign(ownerAuth(), 'D1', { vehiclePublicId: 'NOPE' })).rejects.toThrow(
      NotFoundException,
    )

    ;(h.prisma.vehicle.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99n,
      companyId: 88n,
      status: 'active',
    })
    await expect(h.service.assign(ownerAuth(), 'D1', { vehiclePublicId: 'V2' })).rejects.toThrow(
      ForbiddenException,
    )

    ;(h.prisma.vehicle.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99n,
      companyId: 10n,
      status: 'retired',
    })
    await expect(h.service.assign(ownerAuth(), 'D1', { vehiclePublicId: 'V3' })).rejects.toThrow(
      ConflictException,
    )

    ;(h.prisma.driverVehicleAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { publicId: 'X' },
    )
    await expect(h.service.assign(ownerAuth(), 'D1', { vehiclePublicId: 'V4' })).rejects.toThrow(
      ConflictException,
    )
  })

  it('closes an open assignment', async () => {
    const h = makeHarness()
    ;(h.prisma.driver.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(driverRow())
    ;(h.prisma.driverVehicleAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicId: 'A1',
      vehicleId: 20n,
    })
    const res = await h.service.unassign(ownerAuth(), 'D1', 'A1')
    expect(res.closed).toBe(true)
    expect(h.prisma.driverStatus.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driverId: 30n }, data: { currentVehicleId: null } }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DRIVER_UNASSIGNED' }),
    )
  })

  it('404s when there is no open assignment to close', async () => {
    const h = makeHarness()
    ;(h.prisma.driverVehicleAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    )
    await expect(h.service.unassign(ownerAuth(), 'D1', 'A1')).rejects.toThrow(NotFoundException)
  })
})
