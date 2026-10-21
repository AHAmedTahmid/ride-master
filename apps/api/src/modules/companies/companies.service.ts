import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  COMPANY_REQUIRED_DOCUMENTS,
  CreateCompanyDto,
  SETTINGS_KEYS,
  SetServiceAreasDto,
  UpdateCompanyDto,
} from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { generateUlid } from '../../common/utils/ulid'
import { normalizePhone } from '../../common/utils/phone'
import { currentRequestIp } from '../../common/context/request-context'
import { AuditService } from '../audit/audit.service'
import { AuthService } from '../auth/auth.service'
import { SettingsService } from '../settings/settings.service'

/** Identity fields whose edit on an approved company forces re-review. */
const IDENTITY_FIELDS = ['name', 'tradeName', 'registrationNumber', 'licenceNumber'] as const

const COMPANY_INCLUDE = {
  documents: { orderBy: { createdAt: 'desc' as const } },
  serviceAreas: {
    include: { area: { select: { publicId: true, nameEn: true, nameDv: true, type: true } } },
  },
  _count: {
    select: {
      vehicles: { where: { deletedAt: null } },
      drivers: { where: { deletedAt: null } },
      fares: true,
      surcharges: true,
    },
  },
} satisfies Prisma.CompanyInclude

type CompanyWithView = Prisma.CompanyGetPayload<{ include: typeof COMPANY_INCLUDE }>

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  // ── Signup ──────────────────────────────────────────────────────────────────

  /**
   * Company signup wizard submission: creates the pending company, its
   * service-area links, the consents proof, the owner role (and for
   * individuals the driver role + driver row), then re-pins the session to
   * the company_owner role so the wizard lands in the owner dashboard.
   */
  async create(auth: AuthContext, dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findFirst({
      where: { ownerUserId: auth.userId, deletedAt: null },
      select: { publicId: true },
    })
    if (existing) throw new ConflictException('This account already owns a company')

    const areaIds = await this.resolveAreaIds(dto.serviceAreaIds)
    const phone = this.normalize(dto.phone)
    const startingCredit = await this.settings.getNumber(
      SETTINGS_KEYS.NEW_COMPANY_STARTING_CREDIT_LAARI,
    )

    const company = await this.prisma.$transaction(async (tx) => {
      const row = await tx.company.create({
        data: {
          publicId: generateUlid(),
          ownerUserId: auth.userId,
          type: dto.type,
          name: dto.name,
          tradeName: dto.tradeName ?? null,
          registrationNumber: dto.registrationNumber ?? null,
          licenceNumber: dto.licenceNumber,
          phone,
          email: dto.email ?? null,
          balanceLimitLaari: BigInt(Math.trunc(startingCredit)),
          status: 'pending',
          serviceAreas: { create: areaIds.map((areaId) => ({ areaId })) },
        },
        include: COMPANY_INCLUDE,
      })

      await tx.userRole.create({
        data: {
          publicId: generateUlid(),
          userId: auth.userId,
          role: 'company_owner',
          companyId: row.id,
          status: 'active',
        },
      })

      const ip = currentRequestIp() ?? null
      for (const consent of dto.consents) {
        await tx.userConsent.create({
          data: {
            publicId: generateUlid(),
            userId: auth.userId,
            document: consent.document,
            version: consent.version,
            ipAddress: ip,
          },
        })
      }

      if (dto.type === 'individual') {
        if (!dto.licenceExpiry) {
          throw new BadRequestException('licenceExpiry is required for an individual operator')
        }
        await tx.userRole.create({
          data: {
            publicId: generateUlid(),
            userId: auth.userId,
            role: 'driver',
            companyId: row.id,
            status: 'active',
          },
        })
        await tx.driver.create({
          data: {
            publicId: generateUlid(),
            userId: auth.userId,
            companyId: row.id,
            licenceNumber: dto.licenceNumber,
            licenceExpiry: this.dateOnly(dto.licenceExpiry),
            status: 'pending',
          },
        })
      }

      return row
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_CREATED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { type: dto.type, name: dto.name, status: 'pending' },
    })

    const session = await this.auth.switchRole({
      userId: auth.userId,
      sessionId: auth.sessionId,
      role: 'company_owner',
    })
    return { company: this.view(company), ...session }
  }

  // ── Owner profile ───────────────────────────────────────────────────────────

  /** The caller's company: profile, documents, service areas and counts. */
  async getMine(auth: AuthContext) {
    const companyId = this.policy.resolveCompanyId(auth)
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      include: COMPANY_INCLUDE,
    })
    if (!company) throw new NotFoundException('Company not found')
    return this.view(company)
  }

  async updateMine(auth: AuthContext, dto: UpdateCompanyDto) {
    const companyId = this.policy.resolveCompanyId(auth)
    const before = await this.requireOwnCompany(companyId)

    const identityChanged = IDENTITY_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== before[field],
    )

    const data: Prisma.CompanyUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.tradeName !== undefined) data.tradeName = dto.tradeName
    if (dto.registrationNumber !== undefined) data.registrationNumber = dto.registrationNumber
    if (dto.licenceNumber !== undefined) data.licenceNumber = dto.licenceNumber
    if (dto.phone !== undefined) data.phone = this.normalize(dto.phone)
    if (dto.email !== undefined) data.email = dto.email

    // Editing who you are on an approved company sends it back to review.
    if (identityChanged && before.status === 'approved') data.status = 'pending'

    await this.prisma.company.update({ where: { id: before.id }, data })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_UPDATED',
      entityType: 'company',
      entityId: before.publicId,
      oldValue: pickDefined(before, IDENTITY_FIELDS),
      newValue: {
        ...pickDefined(dto, IDENTITY_FIELDS),
        reviewReset: identityChanged && before.status === 'approved',
      },
    })
    return this.getMine(auth)
  }

  async setServiceAreas(auth: AuthContext, dto: SetServiceAreasDto) {
    const companyId = this.policy.resolveCompanyId(auth)
    const company = await this.requireOwnCompany(companyId)
    const areaIds = await this.resolveAreaIds(dto.areaIds)

    await this.prisma.$transaction(async (tx) => {
      await tx.companyServiceArea.deleteMany({ where: { companyId: company.id } })
      await tx.companyServiceArea.createMany({
        data: areaIds.map((areaId) => ({ companyId: company.id, areaId })),
      })
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_UPDATED',
      entityType: 'company_service_area',
      entityId: company.publicId,
      newValue: { serviceAreas: areaIds.length },
    })
    return this.getMine(auth)
  }

  /** A rejected (or freshly-edited) company goes back into the review queue. */
  async submit(auth: AuthContext) {
    const companyId = this.policy.resolveCompanyId(auth)
    const company = await this.requireOwnCompany(companyId)

    if (company.status === 'pending') throw new ConflictException('Company is already in review')
    if (company.status === 'approved') throw new ConflictException('Company is already approved')
    if (company.status === 'suspended') {
      throw new ForbiddenException('Suspended companies cannot resubmit; contact support')
    }

    const required = COMPANY_REQUIRED_DOCUMENTS[company.type as 'company' | 'individual']
    const documents = await this.prisma.companyDocument.findMany({
      where: { companyId: company.id },
      select: { type: true },
    })
    const present = new Set(documents.map((d) => d.type))
    const missing = required.filter((t) => !present.has(t))
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required documents: ${missing.join(', ')}`)
    }

    await this.prisma.company.update({ where: { id: company.id }, data: { status: 'pending' } })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_SUBMITTED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { status: 'pending' },
    })
    return this.getMine(auth)
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private view(company: CompanyWithView): Record<string, unknown> {
    const required = COMPANY_REQUIRED_DOCUMENTS[company.type as 'company' | 'individual']
    const present = new Set(company.documents.map((d) => d.type))
    return {
      publicId: company.publicId,
      type: company.type,
      name: company.name,
      tradeName: company.tradeName,
      registrationNumber: company.registrationNumber,
      licenceNumber: company.licenceNumber,
      phone: company.phone,
      email: company.email,
      status: company.status,
      approvedAt: company.approvedAt?.toISOString() ?? null,
      balanceLimitLaari: company.balanceLimitLaari.toString(),
      ratingAvg: company.ratingAvg ? Number(company.ratingAvg) : null,
      createdAt: company.createdAt.toISOString(),
      missingDocuments: required.filter((t) => !present.has(t)),
      serviceAreas: company.serviceAreas.map((s) => s.area),
      documents: company.documents.map((d) => ({
        publicId: d.publicId,
        type: d.type,
        expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
        status: d.status,
        uploadedAt: d.createdAt.toISOString(),
      })),
      counts: {
        vehicles: company._count.vehicles,
        drivers: company._count.drivers,
        fares: company._count.fares,
        surcharges: company._count.surcharges,
      },
    }
  }

  private async requireOwnCompany(companyId: bigint) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    })
    if (!company) throw new NotFoundException('Company not found')
    return company
  }

  private async resolveAreaIds(publicIds: string[]): Promise<bigint[]> {
    const unique = [...new Set(publicIds)]
    const rows = await this.prisma.area.findMany({
      where: { publicId: { in: unique }, active: true },
      select: { id: true },
    })
    if (rows.length !== unique.length) {
      throw new BadRequestException('One or more service areas are unknown or inactive')
    }
    return rows.map((r) => r.id)
  }

  private normalize(raw: string): string {
    try {
      return normalizePhone(raw)
    } catch {
      throw new BadRequestException('phone must be a valid Maldivian number')
    }
  }

  private dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`)
  }
}

function pickDefined<T extends object, K extends keyof T & string>(
  source: T,
  keys: readonly K[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
