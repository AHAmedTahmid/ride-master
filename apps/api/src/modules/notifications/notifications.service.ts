import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { NotificationChannel } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { generateUlid } from '../../common/utils/ulid'

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record an in-app (or fallback channel) notification for a user. */
  async notify(params: {
    userId: bigint
    title: string
    body: string
    channel?: NotificationChannel
    data?: Record<string, unknown>
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        publicId: generateUlid(),
        userId: params.userId,
        channel: params.channel ?? 'in_app',
        title: params.title,
        body: params.body,
        data: (params.data as Prisma.InputJsonObject) ?? undefined,
      },
    })
  }

  async listForUser(userId: bigint, limit = 50) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: Math.min(200, limit),
    })
    return rows.map((r) => ({
      publicId: r.publicId,
      channel: r.channel,
      title: r.title,
      body: r.body,
      data: r.data,
      readAt: r.readAt?.toISOString() ?? null,
      sentAt: r.sentAt.toISOString(),
    }))
  }

  async markRead(userId: bigint, publicId: string, read: boolean): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { publicId, userId },
      data: { readAt: read ? new Date() : null },
    })
  }
}
