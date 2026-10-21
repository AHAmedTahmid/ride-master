import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  DOCUMENT_MIME_TYPES,
  DOCUMENT_URL_TTL_SECONDS,
  MAX_DOCUMENT_BYTES,
  UploadDocumentDto,
} from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { PolicyService } from '../../common/policy/policy.service'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'
import { STORAGE_PROVIDER, StorageProvider } from '../../providers/storage/storage.provider'

/** Multipart file as produced by multer (no @types/multer dependency). */
export interface UploadedFile {
  buffer: Buffer
  mimetype: string
  originalname: string
  size: number
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

@Injectable()
export class CompanyDocumentsService {
  private readonly logger = new Logger(CompanyDocumentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Store a licence/registration/insurance document. One document per type:
   * uploading again replaces the previous one (old object deleted). Replacing
   * a document on an approved company sends it back into review.
   */
  async upload(auth: AuthContext, dto: UploadDocumentDto, file?: UploadedFile) {
    if (!file) throw new BadRequestException("Field 'file' is required")
    if (!EXTENSION_BY_MIME[file.mimetype]) {
      throw new BadRequestException(
        `Unsupported file type '${file.mimetype}'. Use ${DOCUMENT_MIME_TYPES.join(', ')}.`,
      )
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('File exceeds the 5 MB limit')
    }

    const company = await this.requireOwnCompany(auth)
    const docPublicId = generateUlid()
    const key = `companies/${company.publicId}/documents/${docPublicId}.${EXTENSION_BY_MIME[file.mimetype]}`
    await this.storage.put(key, file.buffer, file.mimetype)

    const replaced = await this.prisma.companyDocument.findFirst({
      where: { companyId: company.id, type: dto.type },
      orderBy: { createdAt: 'desc' },
    })

    await this.prisma.$transaction(async (tx) => {
      if (replaced) await tx.companyDocument.delete({ where: { id: replaced.id } })
      await tx.companyDocument.create({
        data: {
          publicId: docPublicId,
          companyId: company.id,
          type: dto.type,
          fileKey: key,
          expiryDate: dto.expiryDate ? this.dateOnly(dto.expiryDate) : null,
          status: 'pending',
        },
      })
      if (company.status === 'approved') {
        await tx.company.update({
          where: { id: company.id },
          data: { status: 'pending' },
        })
      }
    })

    if (replaced) {
      try {
        await this.storage.delete(replaced.fileKey)
      } catch (err) {
        this.logger.warn(`Orphaned document object ${replaced.fileKey}: ${String(err)}`)
      }
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'company_document',
      entityId: docPublicId,
      newValue: {
        companyId: company.publicId,
        type: dto.type,
        expiryDate: dto.expiryDate ?? null,
        replaced: replaced?.publicId ?? null,
        reviewReset: company.status === 'approved',
      },
    })

    const doc = await this.prisma.companyDocument.findUniqueOrThrow({
      where: { publicId: docPublicId },
    })
    return this.view(doc)
  }

  /** Short-lived signed URL for viewing an uploaded document. */
  async signedUrl(auth: AuthContext, docPublicId: string) {
    const doc = await this.prisma.companyDocument.findUnique({
      where: { publicId: docPublicId },
      include: { company: { select: { publicId: true } } },
    })
    if (!doc) throw new NotFoundException('Document not found')
    this.policy.requireCompanyScope(auth, doc.company.publicId)

    const url = await this.storage.getSignedUrl(doc.fileKey, DOCUMENT_URL_TTL_SECONDS)
    return {
      publicId: doc.publicId,
      url,
      expiresInSeconds: DOCUMENT_URL_TTL_SECONDS,
    }
  }

  async remove(auth: AuthContext, docPublicId: string) {
    const doc = await this.prisma.companyDocument.findUnique({
      where: { publicId: docPublicId },
      include: { company: { select: { id: true, publicId: true, status: true } } },
    })
    if (!doc) throw new NotFoundException('Document not found')
    this.policy.requireCompanyScope(auth, doc.company.publicId)

    await this.prisma.$transaction(async (tx) => {
      await tx.companyDocument.delete({ where: { id: doc.id } })
      if (doc.company.status === 'approved') {
        await tx.company.update({
          where: { id: doc.company.id },
          data: { status: 'pending' },
        })
      }
    })

    try {
      await this.storage.delete(doc.fileKey)
    } catch (err) {
      this.logger.warn(`Orphaned document object ${doc.fileKey}: ${String(err)}`)
    }

    await this.audit.log({
      actorUserId: auth.userId,
      action: 'DOCUMENT_REMOVED',
      entityType: 'company_document',
      entityId: doc.publicId,
      oldValue: { companyId: doc.company.publicId, type: doc.type },
      newValue: { reviewReset: doc.company.status === 'approved' },
    })
    return { publicId: doc.publicId, removed: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireOwnCompany(auth: AuthContext) {
    const companyId = this.policy.resolveCompanyId(auth)
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true, publicId: true, status: true },
    })
    if (!company) throw new NotFoundException('Company not found')
    return company
  }

  private view(doc: {
    publicId: string
    type: string
    expiryDate: Date | null
    status: string
    createdAt: Date
  }) {
    return {
      publicId: doc.publicId,
      type: doc.type,
      expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().slice(0, 10) : null,
      status: doc.status,
      uploadedAt: doc.createdAt.toISOString(),
    }
  }

  private dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`)
  }
}
