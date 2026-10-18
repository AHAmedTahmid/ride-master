import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'
import { generateUlid } from '../../common/utils/ulid'
import { currentRequestId, currentRequestIp } from '../../common/context/request-context'

export interface AuditEntry {
  actorUserId?: bigint | null
  action: string
  entityType: string
  entityId?: string
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  ip?: string
}

/**
 * Append-only audit trail for sensitive actions (approvals, suspensions,
 * fare edits, commission changes, refunds, admin logins, role changes).
 * Written inside the request (not queued) so an action cannot succeed
 * without its audit row. Never logs secrets.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          publicId: generateUlid(),
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          oldValue: (entry.oldValue as Prisma.InputJsonValue) ?? undefined,
          newValue: (entry.newValue as Prisma.InputJsonValue) ?? undefined,
          ipAddress: entry.ip ?? currentRequestIp() ?? null,
          requestId: currentRequestId() ?? null,
        },
      })
    } catch (err) {
      // Audit failure must be loud but must not mask the original action error.
      this.logger.error(`Audit write failed for ${entry.action}`, err as Error)
    }
  }
}
