import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadDocumentDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { CompanyDocumentsService, UploadedFile } from './company-documents.service'

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    publicId: '01HXYZCOMPANY00000000000C',
    status: 'pending',
    ...overrides,
  }
}

function makeHarness() {
  const docRow = {
    id: 77n,
    publicId: '01HXYZDOC0000000000000000D',
    companyId: 10n,
    type: 'licence',
    fileKey: 'companies/C1/documents/Old.pdf',
    expiryDate: new Date('2028-01-01'),
    status: 'pending',
    createdAt: new Date('2026-01-01'),
  }
  const prisma = {
    company: {
      findFirst: vi.fn(async () => companyRow()),
      update: vi.fn(async () => ({})),
    },
    companyDocument: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...docRow,
        ...args.data,
        createdAt: new Date('2026-02-01'),
      })),
      delete: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({
        ...docRow,
        company: { id: 10n, publicId: '01HXYZCOMPANY00000000000C', status: 'approved' },
      })),
      findUniqueOrThrow: vi.fn(async () => docRow),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  const policy = {
    resolveCompanyId: vi.fn(() => 10n),
    requireCompanyScope: vi.fn(() => undefined),
  }
  const audit = { log: vi.fn(async () => undefined) }
  const storage = {
    put: vi.fn(async (key: string) => key),
    getSignedUrl: vi.fn(async () => 'https://signed.example/doc'),
    delete: vi.fn(async () => undefined),
  }
  const service = new CompanyDocumentsService(
    prisma as never,
    policy as never,
    audit as never,
    storage as never,
  )
  return { service, prisma, policy, audit, storage }
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
    companyPublicId: 'C',
    companyId: 10n,
  }
}

function file(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    buffer: Buffer.from('pdf-bytes'),
    mimetype: 'application/pdf',
    originalname: 'licence.pdf',
    size: 1024,
    ...overrides,
  }
}

const LICENCE: UploadDocumentDto = { type: 'licence', expiryDate: '2028-12-31' }

describe('CompanyDocumentsService — upload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores the file, creates the row and audits the upload', async () => {
    const h = makeHarness()
    const view = await h.service.upload(ownerAuth(), LICENCE, file())

    expect(h.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^companies\/01HXYZCOMPANY00000000000C\/documents\/.+\.pdf$/),
      expect.anything(),
      'application/pdf',
    )
    expect(h.prisma.companyDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'licence',
          expiryDate: new Date('2028-12-31T00:00:00.000Z'),
          status: 'pending',
        }),
      }),
    )
    expect(h.prisma.company.update).not.toHaveBeenCalled()
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_UPLOADED' }),
    )
    expect(view.type).toBe('licence')
  })

  it('replaces an existing document of the same type and deletes the old object', async () => {
    const h = makeHarness()
    ;(h.prisma.companyDocument.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1n,
      publicId: 'OLD',
      fileKey: 'companies/C1/documents/Old.pdf',
      type: 'licence',
    })

    await h.service.upload(ownerAuth(), LICENCE, file())

    expect(h.prisma.companyDocument.delete).toHaveBeenCalledWith({ where: { id: 1n } })
    expect(h.storage.delete).toHaveBeenCalledWith('companies/C1/documents/Old.pdf')
  })

  it('sends an approved company back into review when a document changes', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({ status: 'approved' }),
    )

    await h.service.upload(ownerAuth(), LICENCE, file())

    expect(h.prisma.company.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'pending' },
    })
  })

  it('rejects a missing file, bad mime type and oversized file with 400', async () => {
    const h = makeHarness()
    await expect(h.service.upload(ownerAuth(), LICENCE, undefined)).rejects.toThrow(
      BadRequestException,
    )
    await expect(
      h.service.upload(ownerAuth(), LICENCE, file({ mimetype: 'text/x-script' })),
    ).rejects.toThrow(BadRequestException)
    await expect(
      h.service.upload(ownerAuth(), LICENCE, file({ size: 6 * 1024 * 1024 })),
    ).rejects.toThrow(/5 MB/)
    expect(h.storage.put).not.toHaveBeenCalled()
  })
})

describe('CompanyDocumentsService — viewing and removal', () => {
  it('returns an expiring signed URL for the owning company', async () => {
    const h = makeHarness()
    const res = await h.service.signedUrl(ownerAuth(), 'DOC1')
    expect(res.url).toBe('https://signed.example/doc')
    expect(res.expiresInSeconds).toBe(600)
    expect(h.policy.requireCompanyScope).toHaveBeenCalledWith(expect.anything(), expect.any(String))
  })

  it('forbids another company from viewing the document', async () => {
    const h = makeHarness()
    ;(h.policy.requireCompanyScope as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ForbiddenException('cross-company')
    })
    await expect(h.service.signedUrl(ownerAuth(), 'DOC1')).rejects.toThrow(ForbiddenException)
    expect(h.storage.getSignedUrl).not.toHaveBeenCalled()
  })

  it('removes the row, the object and audits the removal', async () => {
    const h = makeHarness()
    const res = await h.service.remove(ownerAuth(), 'DOC1')
    expect(res.removed).toBe(true)
    expect(h.prisma.companyDocument.delete).toHaveBeenCalled()
    expect(h.prisma.company.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'pending' },
    })
    expect(h.storage.delete).toHaveBeenCalled()
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_REMOVED' }),
    )
  })
})
