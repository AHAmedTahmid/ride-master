import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateSurchargeDto, UpdateSurchargeDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

const SURCHARGE_INCLUDE = {
  company: { select: { publicId: true, name: true } },
} satisfies Prisma.SurchargeInclude

type SurchargeRow = Prisma.SurchargeGetPayload<{ include: typeof SURCHARGE_INCLUDE }>

function timeToDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

function dateToTime(d: Date | null): string | null {
  return d ? d.toISOString().slice(11, 16) : null
}

@Injectable()
export class SurchargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const rows = await this.prisma.surcharge.findMany({
      where: { companyId },
      include: SURCHARGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => this.view(r))
  }

  async create(auth: AuthContext, dto: CreateSurchargeDto, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    await this.requireApprovedCompany(companyId)

    const row = await this.prisma.surcharge.create({
      data: {
        publicId: generateUlid(),
        companyId,
        name: dto.name,
        amountLaari: dto.amountLaari !== undefined ? BigInt(dto.amountLaari) : null,
        percentBps: dto.percentBps !== undefined ? dto.percentBps : null,
        timeFrom: dto.timeFrom ? timeToDate(dto.timeFrom) : null,
        timeTo: dto.timeTo ? timeToDate(dto.timeTo) : null,
        active: dto.active ?? true,
      },
      include: SURCHARGE_INCLUDE,
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SURCHARGE_CREATED',
      entityType: 'surcharge',
      entityId: row.publicId,
      newValue: {
        name: row.name,
        amountLaari: row.amountLaari?.toString(),
        percentBps: row.percentBps,
      },
    })
    return this.view(row)
  }

  async update(
    auth: AuthContext,
    surchargePublicId: string,
    dto: UpdateSurchargeDto,
    company?: string,
  ) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireSurcharge(surchargePublicId, companyId)

    const amountProvided = dto.amountLaari !== undefined
    const percentProvided = dto.percentBps !== undefined

    if (amountProvided && percentProvided) {
      throw new BadRequestException('Provide amountLaari or percentBps, not both')
    }

    const finalAmount = amountProvided
      ? BigInt(dto.amountLaari!)
      : percentProvided
        ? null
        : row.amountLaari
    const finalPercent = percentProvided ? dto.percentBps! : amountProvided ? null : row.percentBps

    const currentFrom = dateToTime(row.timeFrom)
    const currentTo = dateToTime(row.timeTo)

    const timeFromProvided = dto.timeFrom !== undefined
    const timeToProvided = dto.timeTo !== undefined

    const finalFrom = timeFromProvided ? dto.timeFrom : currentFrom
    const finalTo = timeToProvided ? dto.timeTo : currentTo

    if ((finalFrom === null) !== (finalTo === null)) {
      throw new BadRequestException('timeFrom and timeTo must be provided together')
    }

    const updated = await this.prisma.surcharge.update({
      where: { id: row.id },
      data: {
        name: dto.name !== undefined ? dto.name : row.name,
        amountLaari: finalAmount,
        percentBps: finalPercent,
        timeFrom: finalFrom ? timeToDate(finalFrom) : null,
        timeTo: finalTo ? timeToDate(finalTo) : null,
        active: dto.active !== undefined ? dto.active : row.active,
      },
      include: SURCHARGE_INCLUDE,
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SURCHARGE_UPDATED',
      entityType: 'surcharge',
      entityId: surchargePublicId,
      oldValue: {
        name: row.name,
        amountLaari: row.amountLaari?.toString(),
        percentBps: row.percentBps,
        active: row.active,
      },
      newValue: {
        name: updated.name,
        amountLaari: updated.amountLaari?.toString(),
        percentBps: updated.percentBps,
        active: updated.active,
      },
    })
    return this.view(updated)
  }

  async remove(auth: AuthContext, surchargePublicId: string, company?: string) {
    const companyId = await this.policy.resolveTargetCompanyId(auth, company)
    const row = await this.requireSurcharge(surchargePublicId, companyId)

    await this.prisma.surcharge.delete({ where: { id: row.id } })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'SURCHARGE_DELETED',
      entityType: 'surcharge',
      entityId: surchargePublicId,
      oldValue: { name: row.name },
    })
    return { publicId: surchargePublicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireApprovedCompany(companyId: bigint) {
    const comp = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    })
    if (!comp || comp.status !== 'approved') {
      throw new ConflictException('Company must be approved before managing surcharges')
    }
  }

  private async requireSurcharge(publicId: string, companyId: bigint): Promise<SurchargeRow> {
    const row = await this.prisma.surcharge.findFirst({
      where: { publicId },
      include: SURCHARGE_INCLUDE,
    })
    if (!row) throw new NotFoundException('Surcharge not found')
    if (row.companyId !== companyId) {
      throw new ForbiddenException('You cannot access another company\u2019s data')
    }
    return row
  }

  private view(r: SurchargeRow): Record<string, unknown> {
    return {
      publicId: r.publicId,
      name: r.name,
      amountLaari: r.amountLaari ? r.amountLaari.toString() : null,
      percentBps: r.percentBps,
      timeFrom: dateToTime(r.timeFrom),
      timeTo: dateToTime(r.timeTo),
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
