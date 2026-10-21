import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateCompanyDto, UpdateCompanyDto } from '@ride-master/shared'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { CompaniesService } from './companies.service'

const AREA_ROWS = [{ id: 1n }, { id: 2n }]

function baseCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    publicId: '01HXYZCOMPANY00000000000C',
    ownerUserId: 5n,
    type: 'company',
    name: 'Azure Cabs',
    tradeName: null,
    registrationNumber: 'MZ-1',
    licenceNumber: 'OP-1',
    phone: '+9607771234',
    email: null,
    status: 'approved',
    approvedAt: new Date('2026-01-01'),
    balanceLimitLaari: 50000n,
    ratingAvg: null,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    documents: [] as Array<Record<string, unknown>>,
    serviceAreas: [] as Array<{ area: Record<string, unknown> }>,
    _count: { vehicles: 0, drivers: 0, fares: 0, surcharges: 0 },
    ...overrides,
  }
}

function makeHarness() {
  const prisma = {
    company: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...baseCompany({ status: args.data.status, documents: [], serviceAreas: [] }),
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...baseCompany(args.data),
      })),
    },
    area: { findMany: vi.fn(async () => AREA_ROWS) },
    companyDocument: { findMany: vi.fn(async () => []) },
    userRole: { create: vi.fn(async () => ({})) },
    userConsent: { create: vi.fn(async () => ({})) },
    driver: { create: vi.fn(async () => ({})) },
    companyServiceArea: {
      deleteMany: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  const policy = { resolveCompanyId: vi.fn(() => 10n) }
  const audit = { log: vi.fn(async () => undefined) }
  const auth = {
    switchRole: vi.fn(async () => ({
      accessToken: 'new-token',
      user: { publicId: 'U', activeRole: 'company_owner' as const },
    })),
  }
  const settings = { getNumber: vi.fn(async () => 50000) }
  const service = new CompaniesService(
    prisma as never,
    policy as never,
    audit as never,
    auth as never,
    settings as never,
  )
  return { service, prisma, policy, audit, auth, settings }
}

function ownerAuth(): AuthContext {
  return {
    userId: 5n,
    userPublicId: '01HXYZUSER000000000000000U',
    fullName: 'Owner One',
    phone: '+9607770001',
    language: 'en',
    sessionId: 9n,
    sessionPublicId: '01HXYZSESSION000000000000S',
    roles: ['rider'],
    activeRole: 'rider',
  }
}

function ownerRoleAuth(): AuthContext {
  return {
    ...ownerAuth(),
    roles: ['rider', 'company_owner'],
    activeRole: 'company_owner',
    companyPublicId: 'C1',
    companyId: 10n,
  }
}

function companyDto(overrides: Partial<CreateCompanyDto> = {}): CreateCompanyDto {
  return {
    type: 'company',
    name: 'New Cabs',
    registrationNumber: 'MZ-9',
    licenceNumber: 'OP-9',
    phone: '7771234',
    serviceAreaIds: ['A1', 'A2'],
    consents: [
      { document: 'terms', version: '1' },
      { document: 'privacy', version: '1' },
    ],
    ...overrides,
  }
}

function individualDto(overrides: Partial<CreateCompanyDto> = {}): CreateCompanyDto {
  return companyDto({
    type: 'individual',
    name: 'Hassan Ali',
    licenceExpiry: '2028-12-31',
    ...overrides,
  })
}

describe('CompaniesService — signup', () => {
  it('creates a pending company, owner role, consents and re-pins the session', async () => {
    const h = makeHarness()
    const result = await h.service.create(ownerAuth(), companyDto())

    expect(h.prisma.company.create).toHaveBeenCalled()
    const roleCall = (h.prisma.userRole.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(roleCall.data.role).toBe('company_owner')
    expect(roleCall.data.companyId).toBe(10n)
    expect(h.prisma.userConsent.create).toHaveBeenCalledTimes(2)
    expect(h.prisma.driver.create).not.toHaveBeenCalled()
    expect(h.auth.switchRole).toHaveBeenCalledWith({
      userId: 5n,
      sessionId: 9n,
      role: 'company_owner',
    })
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_CREATED' }))
    expect(result.accessToken).toBe('new-token')
    expect(result.company.missingDocuments).toEqual(['licence', 'registration', 'insurance'])
  })

  it('individual signup also creates the driver role and pending driver row', async () => {
    const h = makeHarness()
    await h.service.create(ownerAuth(), individualDto())

    const roles = (h.prisma.userRole.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].data.role,
    )
    expect(roles).toEqual(['company_owner', 'driver'])
    const driverCall = (h.prisma.driver.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(driverCall.data.status).toBe('pending')
    expect(driverCall.data.licenceExpiry).toEqual(new Date('2028-12-31T00:00:00.000Z'))
  })

  it('rejects a second company for the same owner', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicId: 'EXISTING',
    })
    await expect(h.service.create(ownerAuth(), companyDto())).rejects.toThrow(ConflictException)
    expect(h.prisma.company.create).not.toHaveBeenCalled()
  })

  it('rejects unknown or inactive service areas', async () => {
    const h = makeHarness()
    ;(h.prisma.area.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(AREA_ROWS.slice(0, 1))
    await expect(h.service.create(ownerAuth(), companyDto())).rejects.toThrow(BadRequestException)
    expect(h.prisma.company.create).not.toHaveBeenCalled()
  })

  it('rejects a malformed phone number with 400, not 500', async () => {
    const h = makeHarness()
    await expect(
      h.service.create(ownerAuth(), companyDto({ phone: 'not-a-phone' })),
    ).rejects.toThrow(BadRequestException)
  })
})

describe('CompaniesService — profile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getMine lists missing required documents', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({
        documents: [
          {
            publicId: 'D1',
            type: 'licence',
            expiryDate: null,
            status: 'verified',
            createdAt: new Date(),
          },
        ],
      }),
    )
    const view = await h.service.getMine(ownerRoleAuth())
    expect(view.missingDocuments).toEqual(['registration', 'insurance'])
    expect(view.status).toBe('approved')
  })

  it('identity edit on an approved company resets it to pending', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(baseCompany())
    const dto: UpdateCompanyDto = { name: 'Renamed Cabs' }
    await h.service.updateMine(ownerRoleAuth(), dto)

    const updateCall = (h.prisma.company.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.status).toBe('pending')
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_UPDATED' }))
  })

  it('contact-only edit leaves the approved status alone', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(baseCompany())
    await h.service.updateMine(ownerRoleAuth(), { email: 'new@x.mv' })
    const updateCall = (h.prisma.company.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.status).toBeUndefined()
    expect(updateCall.data.email).toBe('new@x.mv')
  })

  it('setServiceAreas replaces the links after validating the areas', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(baseCompany())
    await h.service.setServiceAreas(ownerRoleAuth(), { areaIds: ['A1', 'A2'] })
    expect(h.prisma.companyServiceArea.deleteMany).toHaveBeenCalled()
    expect(h.prisma.companyServiceArea.createMany).toHaveBeenCalledWith({
      data: [
        { companyId: 10n, areaId: 1n },
        { companyId: 10n, areaId: 2n },
      ],
    })
  })
})

describe('CompaniesService — submission', () => {
  it('rejected company with all required documents returns to pending', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({ status: 'rejected' }),
    )
    ;(h.prisma.companyDocument.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'licence' },
      { type: 'registration' },
      { type: 'insurance' },
    ])

    await h.service.submit(ownerRoleAuth())
    expect(h.prisma.company.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'pending' },
    })
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPANY_SUBMITTED' }),
    )
  })

  it('submission with missing documents names them', async () => {
    const h = makeHarness()
    ;(h.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({ status: 'rejected' }),
    )
    ;(h.prisma.companyDocument.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'licence' },
    ])
    await expect(h.service.submit(ownerRoleAuth())).rejects.toThrow(/registration, insurance/)
    expect(h.prisma.company.update).not.toHaveBeenCalled()
  })

  it('pending, approved and suspended companies cannot submit', async () => {
    const h = makeHarness()
    const pending = makeHarness()
    ;(pending.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({ status: 'pending' }),
    )
    await expect(pending.service.submit(ownerRoleAuth())).rejects.toThrow(ConflictException)

    const approved = makeHarness()
    ;(approved.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({ status: 'approved' }),
    )
    await expect(approved.service.submit(ownerRoleAuth())).rejects.toThrow(ConflictException)

    const suspended = makeHarness()
    ;(suspended.prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseCompany({ status: 'suspended' }),
    )
    await expect(suspended.service.submit(ownerRoleAuth())).rejects.toThrow(ForbiddenException)
    void h
  })
})
