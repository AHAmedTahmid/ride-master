import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../../common/decorators/auth.decorators'
import { AreasService } from './areas.service'

function areaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42n,
    public_id: 'A1',
    name_en: 'Malé',
    name_dv: '\u074b\u073f\u072a\u074a',
    type: 'zone',
    active: 1,
    geometry_wkt: 'POLYGON((73.5 4.1,73.6 4.1,73.6 4.2,73.5 4.1))',
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeHarness(rows: unknown[] = [areaRow()]) {
  const prisma = {
    rawQuery: vi.fn(async (sql: string) => {
      if (sql.includes('ST_IsValid')) return [{ ok: 1 }]
      if (sql.startsWith('\n  SELECT') || sql.includes('SELECT id, public_id')) return rows
      return 1
    }),
    companyServiceArea: { count: vi.fn(async () => 0) },
    fare: { count: vi.fn(async () => 0) },
    suggestedFare: { count: vi.fn(async () => 0) },
    booking: { count: vi.fn(async () => 0) },
  }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new AreasService(prisma as never, audit as never)
  return { service, prisma, audit }
}

function superAuth(): AuthContext {
  return {
    userId: 9n,
    userPublicId: 'U9',
    fullName: 'Admin',
    phone: '+9609990001',
    language: 'en',
    sessionId: 3n,
    sessionPublicId: 'S3',
    roles: ['superadmin'],
    activeRole: 'superadmin',
    adminLevel: 'super',
  }
}

const POLYGON = 'POLYGON((73.5 4.1,73.6 4.1,73.6 4.2,73.5 4.1))'

describe('AreasService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists areas with WKT geometry and boolean active', async () => {
    const h = makeHarness()
    const rows = await h.service.list()
    expect(rows[0]).toMatchObject({
      publicId: 'A1',
      nameEn: 'Malé',
      active: true,
      geometryWkt: POLYGON,
    })
    const sql = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(sql).toContain('ST_AsWKT')
  })

  it('filters to active areas when requested', async () => {
    const h = makeHarness()
    await h.service.list({ activeOnly: true })
    const sql = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(sql).toContain('WHERE active = 1')
  })

  it('creates an area after polygon validation and audits it', async () => {
    const h = makeHarness()
    const result = await h.service.create(superAuth(), {
      nameEn: 'Hulhumale',
      nameDv: '\u0747\u073f\u0737\u074d\u0728\u073a\u0726\u074b\u0737\u074a',
      type: 'zone',
      geometryWkt: POLYGON,
    })
    expect(result).toMatchObject({ publicId: 'A1', nameEn: 'Malé' })
    const calls = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toContain('ST_IsValid')
    expect(calls[1][0]).toContain('INSERT INTO areas')
    expect(calls[1][0]).toContain('ST_GeomFromText')
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AREA_CREATED', entityType: 'area' }),
    )
  })

  it('rejects an invalid polygon (ST_IsValid = 0)', async () => {
    const h = makeHarness()
    ;(h.prisma.rawQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ ok: 0 }])
    await expect(
      h.service.create(superAuth(), {
        nameEn: 'X',
        nameDv: 'X',
        type: 'zone',
        geometryWkt: POLYGON,
      }),
    ).rejects.toThrow(BadRequestException)
    expect(h.audit.log).not.toHaveBeenCalled()
  })

  it('maps MySQL GIS errors to a 400', async () => {
    const h = makeHarness()
    ;(h.prisma.rawQuery as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [{ ok: 1 }])
    ;(h.prisma.rawQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ER_GIS_INVALID_DATA: Invalid GIS data provided'),
    )
    await expect(
      h.service.create(superAuth(), {
        nameEn: 'X',
        nameDv: 'X',
        type: 'zone',
        geometryWkt: 'POLYGON((garbage))',
      }),
    ).rejects.toThrow('Invalid POLYGON WKT')
  })

  it('updates only provided fields and audits old/new values', async () => {
    const h = makeHarness()
    await h.service.update(superAuth(), 'A1', { nameEn: 'Mal\u00e9 City' })
    const calls = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls
    const updateSql = calls.find((c) => (c[0] as string).includes('UPDATE'))?.[0] as string
    expect(updateSql).toContain('name_en = ?')
    expect(updateSql).not.toContain('name_dv')
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AREA_UPDATED',
        oldValue: expect.objectContaining({ nameEn: 'Mal\u00e9' }),
        newValue: { nameEn: 'Mal\u00e9 City' },
      }),
    )
  })

  it('updates geometry through ST_GeomFromText after validation', async () => {
    const h = makeHarness()
    await h.service.update(superAuth(), 'A1', { geometryWkt: POLYGON })
    const calls = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls
    const updateSql = calls.find((c) => (c[0] as string).includes('UPDATE'))?.[0] as string
    expect(updateSql).toContain('geometry = ST_GeomFromText(?)')
  })

  it('404s on update of an unknown area', async () => {
    const h = makeHarness([])
    await expect(h.service.update(superAuth(), 'NOPE', { nameEn: 'X' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('blocks delete while any reference exists', async () => {
    const h = makeHarness()
    h.prisma.fare.count = vi.fn(async () => 1)
    await expect(h.service.remove(superAuth(), 'A1')).rejects.toThrow(ConflictException)

    const h2 = makeHarness()
    h2.prisma.companyServiceArea.count = vi.fn(async () => 1)
    await expect(h2.service.remove(superAuth(), 'A1')).rejects.toThrow(ConflictException)
  })

  it('deletes an unreferenced area and audits it', async () => {
    const h = makeHarness()
    const result = await h.service.remove(superAuth(), 'A1')
    expect(result).toEqual({ publicId: 'A1', deleted: true })
    const deleteCall = (h.prisma.rawQuery as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      (c[0] as string).includes('DELETE'),
    )
    expect(deleteCall?.[1]).toEqual(['A1'])
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AREA_DELETED' }))
  })

  it('404s on delete of an unknown area', async () => {
    const h = makeHarness([])
    await expect(h.service.remove(superAuth(), 'NOPE')).rejects.toThrow(NotFoundException)
  })
})
