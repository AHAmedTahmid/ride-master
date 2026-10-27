import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CreateAreaDto, UpdateAreaDto } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuthContext } from '../../common/decorators/auth.decorators'
import { generateUlid } from '../../common/utils/ulid'
import { AuditService } from '../audit/audit.service'

/** Raw rows returned by the spatial queries below (snake_case columns). */
interface AreaRow {
  id: bigint
  public_id: string
  name_en: string
  name_dv: string
  type: string
  active: number
  geometry_wkt: string
  created_at: Date
}

const SELECT_AREA = `
  SELECT id, public_id, name_en, name_dv, type, active, created_at,
         ST_AsWKT(geometry) AS geometry_wkt
  FROM areas`

/** MySQL raises GIS errors (errno 3077 / ER_GIS_INVALID_DATA) on bad WKT. */
function isGisError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /GIS|GEOMETRY|ST_GeomFromText/i.test(message)
}

/**
 * Platform-wide service areas. Geometry is stored as MySQL GEOMETRY and is
 * never mapped by Prisma — all reads/writes go through raw SQL
 * (ST_GeomFromText / ST_AsWKT / ST_IsValid).
 */
@Injectable()
export class AreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(options: { activeOnly?: boolean } = {}): Promise<Record<string, unknown>[]> {
    const sql = options.activeOnly
      ? `${SELECT_AREA} WHERE active = 1 ORDER BY name_en`
      : `${SELECT_AREA} ORDER BY name_en`
    const rows = await this.prisma.rawQuery<AreaRow[]>(sql)
    return rows.map((r) => this.view(r))
  }

  async create(auth: AuthContext, dto: CreateAreaDto) {
    await this.requireValidPolygon(dto.geometryWkt)

    const publicId = generateUlid()
    try {
      await this.prisma.rawQuery(
        `INSERT INTO areas (public_id, name_en, name_dv, type, geometry, active, is_demo)
         VALUES (?, ?, ?, ?, ST_GeomFromText(?), ?, 0)`,
        [publicId, dto.nameEn, dto.nameDv, dto.type, dto.geometryWkt, dto.active === false ? 0 : 1],
      )
    } catch (err) {
      if (isGisError(err)) throw new BadRequestException('Invalid POLYGON WKT')
      throw err
    }

    const row = await this.requireArea(publicId)
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'AREA_CREATED',
      entityType: 'area',
      entityId: publicId,
      newValue: { nameEn: dto.nameEn, nameDv: dto.nameDv, type: dto.type },
    })
    return this.view(row)
  }

  async update(auth: AuthContext, areaPublicId: string, dto: UpdateAreaDto) {
    const before = await this.requireArea(areaPublicId)

    const sets: string[] = []
    const params: unknown[] = []
    const changed: Record<string, unknown> = {}
    if (dto.nameEn !== undefined) {
      sets.push('name_en = ?')
      params.push(dto.nameEn)
      changed.nameEn = dto.nameEn
    }
    if (dto.nameDv !== undefined) {
      sets.push('name_dv = ?')
      params.push(dto.nameDv)
      changed.nameDv = dto.nameDv
    }
    if (dto.type !== undefined) {
      sets.push('type = ?')
      params.push(dto.type)
      changed.type = dto.type
    }
    if (dto.active !== undefined) {
      sets.push('active = ?')
      params.push(dto.active ? 1 : 0)
      changed.active = dto.active
    }
    if (dto.geometryWkt !== undefined) {
      await this.requireValidPolygon(dto.geometryWkt)
      sets.push('geometry = ST_GeomFromText(?)')
      params.push(dto.geometryWkt)
      changed.geometryWkt = dto.geometryWkt
    }

    try {
      await this.prisma.rawQuery(`UPDATE areas SET ${sets.join(', ')} WHERE public_id = ?`, [
        ...params,
        areaPublicId,
      ])
    } catch (err) {
      if (isGisError(err)) throw new BadRequestException('Invalid POLYGON WKT')
      throw err
    }

    const after = await this.requireArea(areaPublicId)
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'AREA_UPDATED',
      entityType: 'area',
      entityId: areaPublicId,
      oldValue: { nameEn: before.name_en, nameDv: before.name_dv, type: before.type },
      newValue: changed,
    })
    return this.view(after)
  }

  /** Hard delete — blocked while any fare, service area, or booking references it. */
  async remove(auth: AuthContext, areaPublicId: string) {
    const row = await this.requireArea(areaPublicId)

    const [serviceAreas, fares, suggestedFares, bookings] = await Promise.all([
      this.prisma.companyServiceArea.count({ where: { areaId: row.id } }),
      this.prisma.fare.count({
        where: { OR: [{ fromAreaId: row.id }, { toAreaId: row.id }] },
      }),
      this.prisma.suggestedFare.count({
        where: { OR: [{ fromAreaId: row.id }, { toAreaId: row.id }] },
      }),
      this.prisma.booking.count({
        where: { OR: [{ fromAreaId: row.id }, { toAreaId: row.id }] },
      }),
    ])
    if (serviceAreas > 0 || fares > 0 || suggestedFares > 0 || bookings > 0) {
      throw new ConflictException(
        'Area is still referenced by service areas, fares, or bookings. Remove those first.',
      )
    }

    await this.prisma.rawQuery(`DELETE FROM areas WHERE public_id = ?`, [areaPublicId])
    await this.audit.log({
      actorUserId: auth.userId,
      action: 'AREA_DELETED',
      entityType: 'area',
      entityId: areaPublicId,
      oldValue: { nameEn: row.name_en, nameDv: row.name_dv },
    })
    return { publicId: areaPublicId, deleted: true }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async requireArea(areaPublicId: string): Promise<AreaRow> {
    const rows = await this.prisma.rawQuery<AreaRow[]>(
      `${SELECT_AREA} WHERE public_id = ? LIMIT 1`,
      [areaPublicId],
    )
    const row = rows[0]
    if (!row) throw new NotFoundException('Area not found')
    return row
  }

  private async requireValidPolygon(wkt: string): Promise<void> {
    try {
      const rows = await this.prisma.rawQuery<{ ok: number }[]>(
        `SELECT ST_IsValid(ST_GeomFromText(?)) AS ok`,
        [wkt],
      )
      if (rows[0]?.ok !== 1) {
        throw new BadRequestException(
          'Polygon is not valid — check that it is a closed ring of (lng lat) pairs',
        )
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      if (isGisError(err)) throw new BadRequestException('Invalid POLYGON WKT')
      throw err
    }
  }

  private view(r: AreaRow): Record<string, unknown> {
    return {
      publicId: r.public_id,
      nameEn: r.name_en,
      nameDv: r.name_dv,
      type: r.type,
      active: r.active === 1,
      geometryWkt: r.geometry_wkt,
      createdAt: r.created_at.toISOString(),
    }
  }
}
