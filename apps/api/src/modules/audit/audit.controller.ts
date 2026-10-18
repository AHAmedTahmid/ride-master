import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/auth.decorators'
import { PrismaService } from '../../database/prisma.service'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Any superadmin level may read the audit log. */
  @Get()
  @Roles('superadmin')
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
    const where = {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ])
    return {
      data: rows.map((r) => ({
        publicId: r.publicId,
        actorUserId: r.actorUserId?.toString() ?? null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValue: r.oldValue ?? null,
        newValue: r.newValue ?? null,
        ipAddress: r.ipAddress,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    }
  }
}
