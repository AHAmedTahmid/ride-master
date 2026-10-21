import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { AdminCompaniesService } from './admin-companies.service'

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    publicId: 'C1',
    ownerUserId: 5n,
    type: 'company',
    name: 'Azure Cabs',
    status: 'pending',
    owner: { fullName: 'Owner One', phone: '+9607770001' },
    documents: [],
    serviceAreas: [],
    _count: { vehicles: 2, drivers: 3, fares: 4, documents: 3 },
    createdAt: new Date('2026-01-01'),
    approvedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeHarness() {
  const prisma = {
    company: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [companyRow()]),
      findFirst: vi.fn(async () => companyRow()),
      update: vi.fn(async () => ({})),
    },
    companyDocument: {
      findMany: vi.fn(async () => [
        { id: 1n, publicId: 'D1', type: 'licence', fileKey: 'k1', status: 'pending' },
        { id: 2n, publicId: 'D2', type: 'registration', fileKey: 'k2', status: 'pending' },
        { id: 3n, publicId: 'D3', type: 'insurance', fileKey: 'k3', status: 'pending' },
      ]),
      updateMany: vi.fn(async () => ({ count: 3 })),
    },
    driver: { updateMany: vi.fn(async () => ({ count: 0 })) },
    userRole: {
      findMany: vi.fn(async () => [{ userId: 5n }, { userId: 6n }]),
    },
    session: { updateMany: vi.fn(async () => ({ count: 2 })) },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg)
      return (arg as (tx: unknown) => Promise<unknown>)(prisma)
    }),
  }
  const audit = { log: vi.fn(async () => undefined) }
  const notifications = { notify: vi.fn(async () => undefined) }
  const storage = {
    put: vi.fn(async (k: string) => k),
    getSignedUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
    delete: vi.fn(async () => undefined),
  }
  const service = new AdminCompaniesService(
    prisma as never,
    audit as never,
    notifications as never,
    storage as never,
  )
  return { service, prisma, audit, notifications, storage }
}

function verifierAuth(): AuthContext {
  return {
    userId: 1n,
    userPublicId: 'V',
    fullName: 'Verifier',
    phone: '+9607770009',
    language: 'en',
    sessionId: 2n,
    sessionPublicId: 'S2',
    roles: ['superadmin'],
    activeRole: 'superadmin',
    adminLevel: 'verifier',
  }
}

describe('AdminCompaniesService — queue', () => {
  it('lists companies with owner and counts plus pagination meta', async () => {
    const h = makeHarness()
    const res = await h.service.list({ status: 'pending', page: 1, limit: 20 })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({
      publicId: 'C1',
      ownerName: 'Owner One',
      vehicleCount: 2,
      documentCount: 3,
    })
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 })
  })

  it('ignores an unknown status filter instead of erroring', async () => {
    const h = makeHarness()
    await h.service.list({ status: 'bogus', page: 1, limit: 20 })
    const countCall = (h.prisma.company.count as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(countCall.where).toEqual({ deletedAt: null })
  })

  it('detail signs every document URL and reports missing types', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({
        documents: [
          {
            id: 1n,
            publicId: 'D1',
            type: 'licence',
            fileKey: 'k1',
            expiryDate: null,
            status: 'pending',
            createdAt: new Date(),
          },
        ],
      }),
    )
    const res = await h.service.detail(verifierAuth(), 'C1')
    expect(h.storage.getSignedUrl).toHaveBeenCalledTimes(1)
    expect(res.missingDocuments).toEqual(['registration', 'insurance'])
    expect((res as { documents: Array<{ url: string }> }).documents[0].url).toBe(
      'https://signed.example/k1',
    )
  })
})

describe('AdminCompaniesService — approve', () => {
  it('approves, verifies documents, activates the individual driver and notifies', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({ type: 'individual' }),
    )

    const res = await h.service.approve(verifierAuth(), 'C1')

    expect(res.status).toBe('approved')
    expect(h.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'approved', approvedBy: 1n }),
      }),
    )
    expect(h.prisma.companyDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 10n, status: 'pending' },
        data: expect.objectContaining({ status: 'verified', verifiedBy: 1n }),
      }),
    )
    expect(h.prisma.driver.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 10n, status: 'pending' },
        data: { status: 'active' },
      }),
    )
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPANY_APPROVED' }),
    )
    expect(h.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 5n, title: 'Company approved' }),
    )
  })

  it('refuses approval while required documents are missing', async () => {
    const h = makeHarness()
    ;(h.prisma.companyDocument.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'licence' },
    ])
    await expect(h.service.approve(verifierAuth(), 'C1')).rejects.toThrow(/registration, insurance/)
    expect(h.prisma.company.update).not.toHaveBeenCalled()
  })

  it('refuses approval for non-pending companies', async () => {
    for (const status of ['approved', 'rejected', 'suspended']) {
      const h = makeHarness()
      ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        companyRow({ status }),
      )
      await expect(h.service.approve(verifierAuth(), 'C1')).rejects.toThrow(ConflictException)
    }
  })
})

describe('AdminCompaniesService — reject, suspend, resume', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reject notifies the owner with the reason and audits it', async () => {
    const h = makeHarness()
    const res = await h.service.reject(verifierAuth(), 'C1', { reason: 'Licence unreadable' })
    expect(res.status).toBe('rejected')
    expect(h.prisma.company.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'rejected' },
    })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPANY_REJECTED',
        newValue: { reason: 'Licence unreadable' },
      }),
    )
    expect(h.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Licence unreadable' }),
    )
  })

  it('suspend revokes owner/driver sessions, audits and notifies', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({ status: 'approved' }),
    )

    const res = await h.service.suspend(verifierAuth(), 'C1', { reason: 'Insurance expired' })

    expect(res.sessionsRevoked).toBe(2)
    expect(h.prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: [5n, 6n] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    )
    expect(h.prisma.company.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'suspended' },
    })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPANY_SUSPENDED' }),
    )
  })

  it('suspend only works on approved companies', async () => {
    const h = makeHarness()
    await expect(h.service.suspend(verifierAuth(), 'C1', { reason: 'x' })).rejects.toThrow(
      ConflictException,
    )
    expect(h.prisma.session.updateMany).not.toHaveBeenCalled()
  })

  it('resume reactivates a suspended company', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({ status: 'suspended' }),
    )
    const res = await h.service.resume(verifierAuth(), 'C1')
    expect(res.status).toBe('approved')
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_RESUMED' }))
  })

  it('resume of a non-suspended company conflicts', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      companyRow({ status: 'approved' }),
    )
    await expect(h.service.resume(verifierAuth(), 'C1')).rejects.toThrow(ConflictException)
  })
})

describe('AdminCompaniesService — missing company', () => {
  it('every decision 404s on an unknown public id', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(h.service.approve(verifierAuth(), 'NOPE')).rejects.toThrow('Company not found')
    await expect(h.service.reject(verifierAuth(), 'NOPE', { reason: 'x' })).rejects.toThrow(
      'Company not found',
    )
    await expect(h.service.suspend(verifierAuth(), 'NOPE', { reason: 'x' })).rejects.toThrow(
      'Company not found',
    )
    await expect(h.service.detail(verifierAuth(), 'NOPE')).rejects.toThrow('Company not found')
  })
})
