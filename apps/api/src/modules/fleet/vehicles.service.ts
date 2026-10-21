import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateVehicleDto, SETTINGS_KEYS, UpdateVehicleDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'
import { SettingsService } from '../settings/settings.service'

const VEHICLE_INCLUDE = {
  vehicleType: { select: { publicId: true, name: true, seats: true, luggageCapacity: true } },
  assignments: {
    where: { assignedTo: null },
    take: 1,
    include: {
      driver: { select: { publicId: true, user: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.VehicleInclude

type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof VEHICLE_INCLUDE }>

/** Prisma unique-constraint violation (duck-typed: no instance coupling). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(auth: AuthContext, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const rows = await this.prisma.vehicle.findMany({
      where: { companyId, deletedAt: null },
      include: VEHICLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((v) => this.view(v))
  }

  async create(auth: AuthContext, dto: CreateVehicleDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)

    const owner = await this.prisma.company.findFirst({
      where: { id: companyId },
      select: { type: true, publicId: true },
    })
    if (!owner) throw new NotFoundException('Company not found')

    if (owner.type === 'individual') {
      const limit = await this.settings.getNumber(SETTINGS_KEYS.INDIVIDUAL_VEHICLE_LIMIT)
      const count = await this.prisma.vehicle.count({ where: { companyId, deletedAt: null } })
      if (count >= limit) {
        throw new ConflictException(
          `Individual operators are limited to ${limit} vehicles. Register as a company to add more.`,
        )
      }
    }

    const vehicleTypeId = await this.requireVehicleType(dto.vehicleTypeId)

    let row: VehicleRow
    try {
      row = await this.prisma.vehicle.create({
        data: {
          publicId: generateUlid(),
          companyId,
          vehicleTypeId,
          plateNumber: dto.plateNumber,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          colour: dto.colour,
          insuranceExpiry: this.dateOnly(dto.insuranceExpiry),
          status: 'active',
        },
        include: VEHICLE_INCLUDE,
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`Plate '${dto.plateNumber}' is already registered`)
      }
      throw err
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_CREATED',
      entityType: 'vehicle',
      entityId: row.publicId,
      newValue: {
        companyId: owner.publicId,
        plateNumber: dto.plateNumber,
        vehicleTypeId: dto.vehicleTypeId,
      },
    })
    return this.view(row)
  }

  async update(
    auth: AuthContext,
    vehiclePublicId: string,
    dto: UpdateVehicleDto,
    company?: string,
  ) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireVehicle(vehiclePublicId, companyId)

    const data: Prisma.VehicleUpdateInput = {}
    if (dto.plateNumber !== undefined) data.plateNumber = dto.plateNumber
    if (dto.make !== undefined) data.make = dto.make
    if (dto.model !== undefined) data.model = dto.model
    if (dto.year !== undefined) data.year = dto.year
    if (dto.colour !== undefined) data.colour = dto.colour
    if (dto.insuranceExpiry !== undefined) data.insuranceExpiry = this.dateOnly(dto.insuranceExpiry)

    let updated: VehicleRow
    try {
      updated = await this.prisma.vehicle.update({
        where: { id: row.id },
        data,
        include: VEHICLE_INCLUDE,
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`Plate '${dto.plateNumber}' is already registered`)
      }
      throw err
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_UPDATED',
      entityType: 'vehicle',
      entityId: row.publicId,
      oldValue: { plateNumber: row.plateNumber, status: row.status },
      newValue: { plateNumber: updated.plateNumber, status: updated.status },
    })
    return this.view(updated)
  }

  async remove(auth: AuthContext, vehiclePublicId: string, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireVehicle(vehiclePublicId, companyId)

    const open = await this.prisma.driverVehicleAssignment.findFirst({
      where: { vehicleId: row.id, assignedTo: null },
      select: { publicId: true },
    })
    if (open) {
      throw new ConflictException('Vehicle has an active driver assignment. Unassign it first.')
    }

    await this.prisma.vehicle.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_DELETED',
      entityType: 'vehicle',
      entityId: row.publicId,
      oldValue: { plateNumber: row.plateNumber },
    })
    return { publicId: row.publicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireVehicle(vehiclePublicId: string, companyId: bigint) {
    const row = await this.prisma.vehicle.findFirst({
      where: { publicId: vehiclePublicId, deletedAt: null },
    })
    if (!row) throw new NotFoundException('Vehicle not found')
    if (row.companyId !== companyId) {
      throw new ForbiddenException('You cannot access another company\u2019s data')
    }
    return row
  }

  private async requireVehicleType(vehicleTypePublicId: string): Promise<bigint> {
    const exists = await this.prisma.vehicleType.findUnique({
      where: { publicId: vehicleTypePublicId },
      select: { id: true },
    })
    if (!exists) throw new BadRequestException('Unknown vehicle type')
    return exists.id
  }

  private view(v: VehicleRow): Record<string, unknown> {
    const open = v.assignments[0]
    return {
      publicId: v.publicId,
      vehicleType: v.vehicleType,
      plateNumber: v.plateNumber,
      make: v.make,
      model: v.model,
      year: v.year,
      colour: v.colour,
      insuranceExpiry: v.insuranceExpiry.toISOString().slice(0, 10),
      status: v.status,
      assignedDriver: open
        ? { publicId: open.driver.publicId, fullName: open.driver.user.fullName }
        : null,
      createdAt: v.createdAt.toISOString(),
    }
  }

  private dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`)
  }
}
