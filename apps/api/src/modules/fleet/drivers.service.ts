import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateAssignmentDto, CreateDriverDto, UpdateDriverDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { normalizePhone } from '../../common/utils/phone'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

const DRIVER_INCLUDE = {
  user: { select: { publicId: true, fullName: true, phone: true } },
  assignments: {
    where: { assignedTo: null },
    take: 1,
    include: {
      vehicle: {
        select: { publicId: true, plateNumber: true },
        include: { vehicleType: { select: { publicId: true, name: true } } },
      },
    },
  },
} satisfies Prisma.DriverInclude

type DriverRow = Prisma.DriverGetPayload<{ include: typeof DRIVER_INCLUDE }>

type DriverAuditAction =
  'DRIVER_CREATED' | 'DRIVER_UPDATED' | 'DRIVER_SUSPENDED' | 'DRIVER_APPROVED' | 'DRIVER_DELETED'

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const rows = await this.prisma.driver.findMany({
      where: { companyId, deletedAt: null },
      include: DRIVER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((d) => this.view(d))
  }

  /** Company adds a driver under its own account (one company at a time). */
  async create(auth: AuthContext, dto: CreateDriverDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)

    const operator = await this.prisma.company.findFirst({
      where: { id: companyId },
      select: { id: true, publicId: true, status: true },
    })
    if (!operator) throw new NotFoundException('Company not found')

    let phone
    try {
      phone = normalizePhone(dto.phone)
    } catch {
      throw new BadRequestException('phone must be a valid Maldivian number')
    }

    // One driver account drives for one company at a time.
    const driverRoles = await this.prisma.userRole.findMany({
      where: { user: { phone }, role: 'driver', status: 'active' },
      select: { companyId: true },
    })
    const ownRole = driverRoles.find((r) => r.companyId === companyId)
    const foreignRole = driverRoles.find((r) => r.companyId !== companyId)
    if (foreignRole && !ownRole) {
      throw new ConflictException(
        `${phone} already drives for another company and cannot be added here`,
      )
    }

    const existingDriver = await this.prisma.driver.findFirst({
      where: { companyId, user: { phone }, deletedAt: null },
      select: { publicId: true },
    })
    if (existingDriver) {
      throw new ConflictException(`${phone} is already a driver of this company`)
    }

    const driver = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phone } })
      if (!user) {
        user = await tx.user.create({
          data: {
            publicId: generateUlid(),
            fullName: dto.fullName,
            phone: phone,
            language: 'en',
            status: 'active',
          },
        })
      }

      let role = await tx.userRole.findFirst({
        where: { userId: user.id, role: 'driver', companyId },
      })
      if (!role) {
        role = await tx.userRole.create({
          data: {
            publicId: generateUlid(),
            userId: user.id,
            role: 'driver',
            companyId,
            status: 'active',
          },
        })
      } else if (role.status !== 'active') {
        role = await tx.userRole.update({
          where: { id: role.id },
          data: { status: 'active' },
        })
      }

      const row = await tx.driver.create({
        data: {
          publicId: generateUlid(),
          userId: user.id,
          companyId,
          licenceNumber: dto.licenceNumber,
          licenceExpiry: this.dateOnly(dto.licenceExpiry),
          status: operator.status === 'approved' ? 'active' : 'pending',
        },
        include: DRIVER_INCLUDE,
      })

      await tx.driverStatus.create({
        data: { driverId: row.id, state: 'offline' },
      })

      return row
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DRIVER_CREATED',
      entityType: 'driver',
      entityId: driver.publicId,
      newValue: {
        companyId: operator.publicId,
        phone: phone,
        fullName: dto.fullName,
        status: driver.status,
      },
    })
    return this.view(driver)
  }

  async update(auth: AuthContext, driverPublicId: string, dto: UpdateDriverDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireDriver(driverPublicId, companyId)

    const status = dto.status ?? row.status
    let action: DriverAuditAction = 'DRIVER_UPDATED'
    if (status === 'suspended') action = 'DRIVER_SUSPENDED'
    else if (status === 'active') action = 'DRIVER_APPROVED'

    if (status === 'suspended') {
      const driverStatus = await this.prisma.driverStatus.findUnique({
        where: { driverId: row.id },
      })
      if (driverStatus?.state === 'on_trip') {
        throw new ConflictException('A driver on an active trip cannot be suspended or removed')
      }
    } else if (status === 'active') {
      const company = await this.prisma.company.findUnique({ where: { id: companyId } })
      if (!company || company.status !== 'approved') {
        throw new ForbiddenException('A driver can only be activated once the company is approved')
      }
    }

    const data: Prisma.DriverUpdateInput = {}
    if (dto.fullName !== undefined) {
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } })
      if (!user) throw new NotFoundException('Driver account not found')
      await this.prisma.user.update({ where: { id: user.id }, data: { fullName: dto.fullName } })
    }
    if (dto.licenceNumber !== undefined) data.licenceNumber = dto.licenceNumber
    if (dto.licenceExpiry !== undefined) data.licenceExpiry = this.dateOnly(dto.licenceExpiry)
    if (dto.idCardNumber !== undefined) data.idCardNumber = dto.idCardNumber ?? null
    if (status !== row.status) data.status = status

    const updated = await this.prisma.driver.update({
      where: { id: row.id },
      data,
      include: DRIVER_INCLUDE,
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action,
      entityType: 'driver',
      entityId: row.publicId,
      newValue: {
        phone: row.user.phone,
        fullName: dto.fullName ?? row.user.fullName,
        status: updated.status,
      },
    })
    return this.view(updated)
  }

  /** Soft-delete the driver and close any open assignment. */
  async remove(auth: AuthContext, driverPublicId: string, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireDriver(driverPublicId, companyId)

    const driverStatus = await this.prisma.driverStatus.findUnique({ where: { driverId: row.id } })
    if (driverStatus?.state === 'on_trip') {
      throw new ConflictException('A driver on an active trip cannot be removed')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({ where: { id: row.id }, data: { deletedAt: new Date() } })
      await tx.driverVehicleAssignment.updateMany({
        where: { driverId: row.id, assignedTo: null },
        data: { assignedTo: new Date() },
      })
      await tx.userRole.updateMany({
        where: { userId: row.userId, role: 'driver', companyId },
        data: { status: 'inactive' },
      })
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DRIVER_DELETED',
      entityType: 'driver',
      entityId: row.publicId,
      oldValue: { phone: row.user.phone },
    })
    return { publicId: row.publicId, removed: true }
  }

  /** Assign an open vehicle to this driver. */
  async assign(
    auth: AuthContext,
    driverPublicId: string,
    dto: CreateAssignmentDto,
    company?: string,
  ) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireDriver(driverPublicId, companyId)

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { publicId: dto.vehiclePublicId, deletedAt: null },
    })
    if (!vehicle) throw new NotFoundException('Vehicle not found')
    if (vehicle.companyId !== companyId)
      throw new ForbiddenException('You cannot access another company\u2019s data')
    if (vehicle.status === 'retired')
      throw new ConflictException('A retired vehicle cannot be assigned')

    const vehicleTaken = await this.prisma.driverVehicleAssignment.findFirst({
      where: { vehicleId: vehicle.id, assignedTo: null },
      select: { publicId: true },
    })
    if (vehicleTaken) throw new ConflictException('This vehicle already has an open assignment')

    const driverTaken = await this.prisma.driverVehicleAssignment.findFirst({
      where: { driverId: row.id, assignedTo: null },
      select: { publicId: true },
    })
    if (driverTaken) throw new ConflictException('This driver already has an open assignment')

    const assignment = await this.prisma.driverVehicleAssignment.create({
      data: { publicId: generateUlid(), driverId: row.id, vehicleId: vehicle.id },
      include: {
        vehicle: { select: { publicId: true, plateNumber: true } },
        driver: { select: { publicId: true, user: { select: { fullName: true } } } },
      },
    })

    await this.prisma.driverStatus.upsert({
      where: { driverId: row.id },
      update: { currentVehicleId: vehicle.id },
      create: { driverId: row.id, state: 'offline', currentVehicleId: vehicle.id },
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DRIVER_ASSIGNED',
      entityType: 'driver_vehicle_assignment',
      entityId: assignment.publicId,
      newValue: { driverPublicId: row.publicId, vehiclePublicId: vehicle.publicId },
    })
    return assignment
  }

  /** Close the driver\u2019s current assignment. */
  async unassign(
    auth: AuthContext,
    driverPublicId: string,
    assignmentPublicId: string,
    company?: string,
  ) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireDriver(driverPublicId, companyId)

    const assignment = await this.prisma.driverVehicleAssignment.findFirst({
      where: { publicId: assignmentPublicId, driverId: row.id, assignedTo: null },
      select: { publicId: true, vehicleId: true },
    })
    if (!assignment) throw new NotFoundException('No open assignment found for this driver')

    await this.prisma.$transaction(async (tx) => {
      await tx.driverVehicleAssignment.update({
        where: { publicId: assignment.publicId },
        data: { assignedTo: new Date() },
      })
      await tx.driverStatus.update({
        where: { driverId: row.id },
        data: { currentVehicleId: null },
      })
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DRIVER_UNASSIGNED',
      entityType: 'driver_vehicle_assignment',
      entityId: assignment.publicId,
      oldValue: { vehicleId: assignment.vehicleId },
    })
    return { publicId: assignment.publicId, closed: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireDriver(driverPublicId: string, companyId: bigint) {
    const row = await this.prisma.driver.findFirst({
      where: { publicId: driverPublicId, deletedAt: null },
      include: { user: true },
    })
    if (!row) throw new NotFoundException('Driver not found')
    if (row.companyId !== companyId) {
      throw new ForbiddenException('You cannot access another company\u2019s data')
    }
    return row
  }

  private dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`)
  }

  private view(d: DriverRow): Record<string, unknown> {
    const open = d.assignments[0]
    return {
      publicId: d.publicId,
      user: d.user,
      licenceNumber: d.licenceNumber,
      licenceExpiry: d.licenceExpiry.toISOString().slice(0, 10),
      status: d.status,
      ratingAvg: d.ratingAvg ? Number(d.ratingAvg) : null,
      vehicle: open
        ? { publicId: open.vehicle.publicId, plateNumber: open.vehicle.plateNumber }
        : null,
      createdAt: d.createdAt.toISOString(),
    }
  }
}
