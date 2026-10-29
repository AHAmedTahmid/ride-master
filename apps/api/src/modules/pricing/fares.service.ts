import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateFareDto, ImportSuggestedFareDto, UpdateFareDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

const FARE_INCLUDE = {
  fromArea: { select: { publicId: true, nameEn: true, nameDv: true } },
  toArea: { select: { publicId: true, nameEn: true, nameDv: true } },
  vehicleType: { select: { publicId: true, name: true, seats: true } },
  history: {
    orderBy: { changedAt: 'desc' },
    select: { publicId: true, oldPriceLaari: true, newPriceLaari: true, changedAt: true },
  },
} satisfies Prisma.FareInclude

type FareRow = Prisma.FareGetPayload<{ include: typeof FARE_INCLUDE }>

/** Prisma unique-constraint violation (duck-typed). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

@Injectable()
export class FaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const rows = await this.prisma.fare.findMany({
      where: { companyId },
      include: FARE_INCLUDE,
      orderBy: [{ vehicleTypeId: 'asc' }, { fromAreaId: 'asc' }, { toAreaId: 'asc' }],
    })
    return rows.map((r) => this.view(r))
  }

  async create(auth: AuthContext, dto: CreateFareDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    await this.requireApprovedCompany(companyId)

    const fromAreaId = await this.requireArea(dto.fromAreaId)
    const toAreaId = await this.requireArea(dto.toAreaId)
    if (fromAreaId === toAreaId) {
      throw new BadRequestException('fromAreaId and toAreaId must differ')
    }
    const vehicleTypeId = await this.requireVehicleType(dto.vehicleTypeId)

    let row: FareRow
    try {
      row = await this.prisma.fare.create({
        data: {
          publicId: generateUlid(),
          companyId,
          fromAreaId,
          toAreaId,
          vehicleTypeId,
          priceLaari: BigInt(dto.priceLaari),
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          active: true,
        },
        include: FARE_INCLUDE,
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A fare for this route and vehicle type already exists')
      }
      throw err
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'FARE_CREATED',
      entityType: 'fare',
      entityId: row.publicId,
      newValue: { priceLaari: dto.priceLaari, vehicleTypeId: dto.vehicleTypeId },
    })
    return this.view(row)
  }

  /** One-tap import from platform suggested fare. */
  async fromSuggested(auth: AuthContext, dto: ImportSuggestedFareDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    await this.requireApprovedCompany(companyId)

    const suggested = await this.prisma.suggestedFare.findUnique({
      where: { publicId: dto.suggestedFarePublicId },
    })
    if (!suggested) throw new NotFoundException('Suggested fare not found')

    let row: FareRow
    try {
      row = await this.prisma.fare.create({
        data: {
          publicId: generateUlid(),
          companyId,
          fromAreaId: suggested.fromAreaId,
          toAreaId: suggested.toAreaId,
          vehicleTypeId: suggested.vehicleTypeId,
          priceLaari: suggested.priceLaari,
          active: true,
        },
        include: FARE_INCLUDE,
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A fare for this route and vehicle type already exists')
      }
      throw err
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'FARE_CREATED',
      entityType: 'fare',
      entityId: row.publicId,
      newValue: { priceLaari: suggested.priceLaari.toString(), source: 'suggested' },
    })
    return this.view(row)
  }

  async update(auth: AuthContext, farePublicId: string, dto: UpdateFareDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireFare(farePublicId, companyId)

    const newPrice = dto.priceLaari !== undefined ? BigInt(dto.priceLaari) : row.priceLaari
    const priceChanged = dto.priceLaari !== undefined && newPrice !== row.priceLaari
    const newActive = dto.active !== undefined ? dto.active : row.active

    const updated = await this.prisma.$transaction(async (tx) => {
      if (priceChanged) {
        await tx.fareHistory.create({
          data: {
            publicId: generateUlid(),
            fareId: row.id,
            oldPriceLaari: row.priceLaari,
            newPriceLaari: newPrice,
            changedBy: auth.userId,
          },
        })
      }
      return tx.fare.update({
        where: { id: row.id },
        data: {
          priceLaari: newPrice,
          active: newActive,
        },
        include: FARE_INCLUDE,
      })
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'FARE_UPDATED',
      entityType: 'fare',
      entityId: farePublicId,
      oldValue: { priceLaari: row.priceLaari.toString(), active: row.active },
      newValue: { priceLaari: updated.priceLaari.toString(), active: updated.active },
    })
    return this.view(updated)
  }

  async remove(auth: AuthContext, farePublicId: string, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireFare(farePublicId, companyId)

    if (row.history.length > 0) {
      throw new ConflictException(
        'Cannot delete fare because price history exists. Set active: false instead.',
      )
    }

    await this.prisma.fare.delete({ where: { id: row.id } })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'FARE_DELETED',
      entityType: 'fare',
      entityId: farePublicId,
      oldValue: { priceLaari: row.priceLaari.toString() },
    })
    return { publicId: farePublicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireApprovedCompany(companyId: bigint) {
    const comp = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    })
    if (!comp || comp.status !== 'approved') {
      throw new ConflictException('Company must be approved before managing fares')
    }
  }

  private async requireFare(farePublicId: string, companyId: bigint): Promise<FareRow> {
    const row = await this.prisma.fare.findFirst({
      where: { publicId: farePublicId },
      include: FARE_INCLUDE,
    })
    if (!row) throw new NotFoundException('Fare not found')
    if (row.companyId !== companyId) {
      throw new ForbiddenException('You cannot access another company\u2019s data')
    }
    return row
  }

  private async requireArea(publicId: string): Promise<bigint> {
    const area = await this.prisma.area.findUnique({
      where: { publicId },
      select: { id: true },
    })
    if (!area) throw new BadRequestException('Unknown area')
    return area.id
  }

  private async requireVehicleType(publicId: string): Promise<bigint> {
    const vt = await this.prisma.vehicleType.findUnique({
      where: { publicId },
      select: { id: true },
    })
    if (!vt) throw new BadRequestException('Unknown vehicle type')
    return vt.id
  }

  private view(r: FareRow): Record<string, unknown> {
    return {
      publicId: r.publicId,
      fromArea: r.fromArea,
      toArea: r.toArea,
      vehicleType: r.vehicleType,
      priceLaari: r.priceLaari.toString(),
      active: r.active,
      validFrom: r.validFrom ? r.validFrom.toISOString() : null,
      validTo: r.validTo ? r.validTo.toISOString() : null,
      history: r.history.map((h) => ({
        publicId: h.publicId,
        oldPriceLaari: h.oldPriceLaari.toString(),
        newPriceLaari: h.newPriceLaari.toString(),
        changedAt: h.changedAt.toISOString(),
      })),
      createdAt: r.createdAt.toISOString(),
    }
  }
}
