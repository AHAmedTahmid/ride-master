import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateSuggestedFareDto, UpdateSuggestedFareDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

const SUGGESTED_INCLUDE = {
  fromArea: { select: { publicId: true, nameEn: true, nameDv: true } },
  toArea: { select: { publicId: true, nameEn: true, nameDv: true } },
  vehicleType: { select: { publicId: true, name: true, seats: true } },
} satisfies Prisma.SuggestedFareInclude

type SuggestedFareRow = Prisma.SuggestedFareGetPayload<{ include: typeof SUGGESTED_INCLUDE }>

/** Prisma unique-constraint violation (duck-typed: no instance coupling). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/**
 * Platform-suggested base prices per (from area, to area, vehicle type).
 * Companies copy these with one tap when publishing their own fares.
 */
@Injectable()
export class SuggestedFaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.suggestedFare.findMany({
      include: SUGGESTED_INCLUDE,
      orderBy: [{ vehicleTypeId: 'asc' }, { fromAreaId: 'asc' }, { toAreaId: 'asc' }],
    })
    return rows.map((r) => this.view(r))
  }

  async create(auth: AuthContext, dto: CreateSuggestedFareDto) {
    const { fromAreaId, toAreaId, vehicleTypeId } = await this.resolveRefs(dto)

    let row: SuggestedFareRow
    try {
      row = await this.prisma.suggestedFare.create({
        data: {
          publicId: generateUlid(),
          fromAreaId,
          toAreaId,
          vehicleTypeId,
          priceLaari: BigInt(dto.priceLaari),
          createdBy: auth.userId,
        },
        include: SUGGESTED_INCLUDE,
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'A suggested fare for this route and vehicle type already exists — update it instead',
        )
      }
      throw err
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SUGGESTED_FARE_CREATED',
      entityType: 'suggested_fare',
      entityId: row.publicId,
      newValue: {
        fromAreaId: dto.fromAreaId,
        toAreaId: dto.toAreaId,
        vehicleTypeId: dto.vehicleTypeId,
        priceLaari: dto.priceLaari,
      },
    })
    return this.view(row)
  }

  async update(auth: AuthContext, publicId: string, dto: UpdateSuggestedFareDto) {
    const before = await this.prisma.suggestedFare.findUnique({ where: { publicId } })
    if (!before) throw new NotFoundException('Suggested fare not found')

    const row = await this.prisma.suggestedFare.update({
      where: { id: before.id },
      data: { priceLaari: BigInt(dto.priceLaari) },
      include: SUGGESTED_INCLUDE,
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SUGGESTED_FARE_UPDATED',
      entityType: 'suggested_fare',
      entityId: publicId,
      oldValue: { priceLaari: before.priceLaari.toString() },
      newValue: { priceLaari: dto.priceLaari },
    })
    return this.view(row)
  }

  async remove(auth: AuthContext, publicId: string) {
    const row = await this.prisma.suggestedFare.findUnique({ where: { publicId } })
    if (!row) throw new NotFoundException('Suggested fare not found')

    await this.prisma.suggestedFare.delete({ where: { id: row.id } })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SUGGESTED_FARE_DELETED',
      entityType: 'suggested_fare',
      entityId: publicId,
      oldValue: { priceLaari: row.priceLaari.toString() },
    })
    return { publicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async resolveRefs(dto: CreateSuggestedFareDto) {
    const [fromArea, toArea, vehicleType] = await Promise.all([
      this.prisma.area.findUnique({
        where: { publicId: dto.fromAreaId },
        select: { id: true },
      }),
      this.prisma.area.findUnique({ where: { publicId: dto.toAreaId }, select: { id: true } }),
      this.prisma.vehicleType.findUnique({
        where: { publicId: dto.vehicleTypeId },
        select: { id: true },
      }),
    ])
    if (!fromArea || !toArea) throw new BadRequestException('Unknown area')
    if (fromArea.id === toArea.id) {
      throw new BadRequestException('fromAreaId and toAreaId must differ')
    }
    if (!vehicleType) throw new BadRequestException('Unknown vehicle type')
    return { fromAreaId: fromArea.id, toAreaId: toArea.id, vehicleTypeId: vehicleType.id }
  }

  private view(r: SuggestedFareRow): Record<string, unknown> {
    return {
      publicId: r.publicId,
      fromArea: r.fromArea,
      toArea: r.toArea,
      vehicleType: r.vehicleType,
      priceLaari: r.priceLaari.toString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }
}
