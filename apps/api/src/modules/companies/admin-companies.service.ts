import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  COMPANY_REQUIRED_DOCUMENTS,
  DOCUMENT_URL_TTL_SECONDS,
  RejectCompanyDto,
  SuspendCompanyDto,
} from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { STORAGE_PROVIDER, StorageProvider } from '../../providers/storage/storage.provider'

const QUEUE_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const

@Injectable()
export class AdminCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Queue ───────────────────────────────────────────────────────────────────

  async list(params: { status?: string; page: number; limit: number }) {
    const status =
      params.status && (QUEUE_STATUSES as readonly string[]).includes(params.status)
        ? params.status
        : undefined
    const where = { ...(status ? { status } : {}), deletedAt: null }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        include: {
          owner: { select: { fullName: true, phone: true } },
          _count: {
            select: {
              documents: true,
              vehicles: { where: { deletedAt: null } },
              drivers: { where: { deletedAt: null } },
              fares: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    ])

    return {
      data: rows.map((c) => ({
        publicId: c.publicId,
        type: c.type,
        name: c.name,
        status: c.status,
        phone: c.phone,
        ownerName: c.owner.fullName,
        documentCount: c._count.documents,
        vehicleCount: c._count.vehicles,
        driverCount: c._count.drivers,
        fareCount: c._count.fares,
        createdAt: c.createdAt.toISOString(),
      })),
      meta: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    }
  }

  /** Review detail: profile, owner, areas, documents with signed URLs. */
  async detail(auth: AuthContext, companyPublicId: string) {
    const company = await this.prisma.company.findFirst({
      where: { publicId: companyPublicId, deletedAt: null },
      include: {
        owner: { select: { publicId: true, fullName: true, phone: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        serviceAreas: {
          include: {
            area: { select: { publicId: true, nameEn: true, nameDv: true, type: true } },
          },
        },
        _count: {
          select: {
            vehicles: { where: { deletedAt: null } },
            drivers: { where: { deletedAt: null } },
            fares: true,
          },
        },
      },
    })
    if (!company) throw new NotFoundException('Company not found')

    const required = COMPANY_REQUIRED_DOCUMENTS[company.type as 'company' | 'individual']
    const present = new Set(company.documents.map((d) => d.type))

    const documents = await Promise.all(
      company.documents.map(async (d) => ({
        publicId: d.publicId,
        type: d.type,
        expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
        status: d.status,
        uploadedAt: d.createdAt.toISOString(),
        url: await this.storage.getSignedUrl(d.fileKey, DOCUMENT_URL_TTL_SECONDS),
      })),
    )

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
      createdAt: company.createdAt.toISOString(),
      missingDocuments: required.filter((t) => !present.has(t)),
      owner: company.owner,
      serviceAreas: company.serviceAreas.map((s) => s.area),
      documents,
      counts: {
        vehicles: company._count.vehicles,
        drivers: company._count.drivers,
        fares: company._count.fares,
      },
      reviewer: { userPublicId: auth.userPublicId, adminLevel: auth.adminLevel },
    }
  }

  // ── Decisions ───────────────────────────────────────────────────────────────

  async approve(auth: AuthContext, companyPublicId: string) {
    const company = await this.requirePending(companyPublicId)

    const required = COMPANY_REQUIRED_DOCUMENTS[company.type as 'company' | 'individual']
    const documents = await this.prisma.companyDocument.findMany({
      where: { companyId: company.id },
    })
    const present = new Set(documents.map((d) => d.type))
    const missing = required.filter((t) => !present.has(t))
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required documents: ${missing.join(', ')}`)
    }

    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: company.id },
        data: { status: 'approved', approvedBy: auth.userId, approvedAt: now },
      })
      await tx.companyDocument.updateMany({
        where: { companyId: company.id, status: 'pending' },
        data: { status: 'verified', verifiedBy: auth.userId, verifiedAt: now },
      })
      if (company.type === 'individual') {
        await tx.driver.updateMany({
          where: { companyId: company.id, status: 'pending' },
          data: { status: 'active' },
        })
      }
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_APPROVED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { documentsVerified: documents.length, type: company.type },
    })
    await this.notifications.notify({
      userId: company.ownerUserId,
      title: 'Company approved',
      body: `${company.name} is approved. Your fleet and fares are now live on Ride Master.`,
      data: { companyPublicId: company.publicId, status: 'approved' },
    })
    return { publicId: company.publicId, status: 'approved' }
  }

  async reject(auth: AuthContext, companyPublicId: string, dto: RejectCompanyDto) {
    const company = await this.requirePending(companyPublicId)

    await this.prisma.company.update({
      where: { id: company.id },
      data: { status: 'rejected' },
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_REJECTED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { reason: dto.reason },
    })
    await this.notifications.notify({
      userId: company.ownerUserId,
      title: 'Application needs changes',
      body: dto.reason,
      data: { companyPublicId: company.publicId, status: 'rejected' },
    })
    return { publicId: company.publicId, status: 'rejected' }
  }

  /** Suspend instantly: every owner/driver session for the company dies now. */
  async suspend(auth: AuthContext, companyPublicId: string, dto: SuspendCompanyDto) {
    const company = await this.prisma.company.findFirst({
      where: { publicId: companyPublicId, deletedAt: null },
    })
    if (!company) throw new NotFoundException('Company not found')
    if (company.status !== 'approved') {
      throw new ConflictException('Only an approved company can be suspended')
    }

    const roleHolders = await this.prisma.userRole.findMany({
      where: { companyId: company.id, role: { in: ['company_owner', 'driver'] } },
      select: { userId: true },
    })
    const userIds = [...new Set(roleHolders.map((r) => r.userId))]

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { status: 'suspended' } })
      if (userIds.length > 0) {
        await tx.session.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
    })

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_SUSPENDED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { reason: dto.reason, sessionsRevoked: userIds.length },
    })
    await this.notifications.notify({
      userId: company.ownerUserId,
      title: 'Company suspended',
      body: dto.reason,
      data: { companyPublicId: company.publicId, status: 'suspended' },
    })
    return { publicId: company.publicId, status: 'suspended', sessionsRevoked: userIds.length }
  }

  async resume(auth: AuthContext, companyPublicId: string) {
    const company = await this.prisma.company.findFirst({
      where: { publicId: companyPublicId, deletedAt: null },
    })
    if (!company) throw new NotFoundException('Company not found')
    if (company.status !== 'suspended') {
      throw new ConflictException('Only a suspended company can be resumed')
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: { status: 'approved' },
    })
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'COMPANY_RESUMED',
      entityType: 'company',
      entityId: company.publicId,
      newValue: { status: 'approved' },
    })
    await this.notifications.notify({
      userId: company.ownerUserId,
      title: 'Company resumed',
      body: `${company.name} is active again and receiving requests.`,
      data: { companyPublicId: company.publicId, status: 'approved' },
    })
    return { publicId: company.publicId, status: 'approved' }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requirePending(companyPublicId: string) {
    const company = await this.prisma.company.findFirst({
      where: { publicId: companyPublicId, deletedAt: null },
    })
    if (!company) throw new NotFoundException('Company not found')
    if (company.status === 'pending') return company
    if (company.status === 'approved') {
      throw new ConflictException('Company is already approved')
    }
    if (company.status === 'suspended') {
      throw new ConflictException('Company is suspended; resume it first')
    }
    throw new ConflictException('Company was rejected; wait for it to be resubmitted')
  }
}
