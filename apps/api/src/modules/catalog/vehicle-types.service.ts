import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateVehicleTypeDto, UpdateVehicleTypeDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

const VEHICLE_TYPE_INCLUDE = {
  _count: {
    select: {
      vehicles: { where: { deletedAt: null } },
      fares: true,
      suggestedFares: true,
    },
  },
} satisfies Prisma.VehicleTypeInclude

type VehicleTypeRow = Prisma.VehicleTypeGetPayload<{ include: typeof VEHICLE_TYPE_INCLUDE }>

/** Platform-wide vehicle types (catalog). Companies pick these when adding vehicles. */
@Injectable()
export class VehicleTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.vehicleType.findMany({
      include: VEHICLE_TYPE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return rows.map((r) => this.view(r))
  }

  async create(auth: AuthContext, dto: CreateVehicleTypeDto) {
    const row = await this.prisma.vehicleType.create({
      data: {
        publicId: generateUlid(),
        name: dto.name,
        seats: dto.seats,
        luggageCapacity: dto.luggageCapacity,
        sortOrder: dto.sortOrder,
      },
      include: VEHICLE_TYPE_INCLUDE,
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_TYPE_CREATED',
      entityType: 'vehicle_type',
      entityId: row.publicId,
      newValue: { name: row.name, seats: row.seats },
    })
    return this.view(row)
  }

  async update(auth: AuthContext, publicId: string, dto: UpdateVehicleTypeDto) {
    const before = await this.requireVehicleType(publicId)

    const data: Prisma.VehicleTypeUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.seats !== undefined) data.seats = dto.seats
    if (dto.luggageCapacity !== undefined) data.luggageCapacity = dto.luggageCapacity
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder

    const row = await this.prisma.vehicleType.update({
      where: { id: before.id },
      data,
      include: VEHICLE_TYPE_INCLUDE,
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_TYPE_UPDATED',
      entityType: 'vehicle_type',
      entityId: publicId,
      oldValue: { name: before.name, seats: before.seats },
      newValue: { name: row.name, seats: row.seats },
    })
    return this.view(row)
  }

  /** Hard delete — blocked while vehicles, fares, or bookings reference the type. */
  async remove(auth: AuthContext, publicId: string) {
    const row = await this.requireVehicleType(publicId)

    const [vehicles, fares, suggestedFares, bookings] = await Promise.all([
      this.prisma.vehicle.count({ where: { vehicleTypeId: row.id, deletedAt: null } }),
      this.prisma.fare.count({ where: { vehicleTypeId: row.id } }),
      this.prisma.suggestedFare.count({ where: { vehicleTypeId: row.id } }),
      this.prisma.booking.count({ where: { vehicleTypeId: row.id } }),
    ])
    if (vehicles > 0 || fares > 0 || suggestedFares > 0 || bookings > 0) {
      throw new ConflictException(
        'Vehicle type is still referenced by vehicles, fares, or bookings. Remove those first.',
      )
    }

    await this.prisma.vehicleType.delete({ where: { id: row.id } })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'VEHICLE_TYPE_DELETED',
      entityType: 'vehicle_type',
      entityId: publicId,
      oldValue: { name: row.name },
    })
    return { publicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireVehicleType(publicId: string): Promise<VehicleTypeRow> {
    const row = await this.prisma.vehicleType.findUnique({
      where: { publicId },
      include: VEHICLE_TYPE_INCLUDE,
    })
    if (!row) throw new NotFoundException('Vehicle type not found')
    return row
  }

  private view(r: VehicleTypeRow): Record<string, unknown> {
    return {
      publicId: r.publicId,
      name: r.name,
      seats: r.seats,
      luggageCapacity: r.luggageCapacity,
      sortOrder: r.sortOrder,
      counts: {
        vehicles: r._count.vehicles,
        fares: r._count.fares,
        suggestedFares: r._count.suggestedFares,
      },
      createdAt: r.createdAt.toISOString(),
    }
  }
}
