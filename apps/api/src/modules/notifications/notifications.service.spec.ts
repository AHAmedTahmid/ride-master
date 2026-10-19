import { describe, expect, it, vi } from 'vitest'
import { NotificationsService } from './notifications.service'

function makeService(rows: unknown[] = []) {
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => args.data)
  const findMany = vi.fn(async () => rows)
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const prisma = {
    notification: { create, findMany, updateMany },
  }
  return { service: new NotificationsService(prisma as never), prisma }
}

describe('NotificationsService', () => {
  it('creates an in-app notification by default', async () => {
    const { service, prisma } = makeService()
    await service.notify({ userId: 1n, title: 'T', body: 'B' })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'in_app',
        title: 'T',
        body: 'B',
      }),
    })
  })

  it('lists a user’s notifications newest-first with ISO timestamps', async () => {
    const sentAt = new Date('2026-01-01T00:00:00.000Z')
    const readAt = new Date('2026-01-02T00:00:00.000Z')
    const { service } = makeService([
      {
        publicId: 'N1',
        channel: 'sms',
        title: 'Trip done',
        body: 'Thanks',
        data: null,
        readAt,
        sentAt,
      },
    ])
    const list = await service.listForUser(1n)
    expect(list).toEqual([
      {
        publicId: 'N1',
        channel: 'sms',
        title: 'Trip done',
        body: 'Thanks',
        data: null,
        readAt: readAt.toISOString(),
        sentAt: sentAt.toISOString(),
      },
    ])
  })

  it('caps the page size at 200', async () => {
    const { service, prisma } = makeService([])
    await service.listForUser(1n, 5000)
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })

  it('scopes markRead to the owner (never another user’s row)', async () => {
    const { service, prisma } = makeService()
    await service.markRead(1n, 'N1', true)
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { publicId: 'N1', userId: 1n },
      data: { readAt: expect.any(Date) },
    })
  })

  it('unmarks by clearing readAt', async () => {
    const { service, prisma } = makeService()
    await service.markRead(1n, 'N1', false)
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { readAt: null } }),
    )
  })
})
