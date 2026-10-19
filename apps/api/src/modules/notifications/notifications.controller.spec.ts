import { describe, expect, it, vi } from 'vitest'
import { NotificationsController } from './notifications.controller'

function makeController(rows: unknown[] = []) {
  const service = {
    listForUser: vi.fn(async () => rows),
    markRead: vi.fn(async () => undefined),
  }
  return { controller: new NotificationsController(service as never), service }
}

const CTX = { userId: 1n } as never

describe('NotificationsController', () => {
  it('lists the caller’s notifications', async () => {
    const { controller, service } = makeController([{ publicId: 'N1' }])
    const result = await controller.list(CTX)
    expect(result).toEqual([{ publicId: 'N1' }])
    expect(service.listForUser).toHaveBeenCalledWith(1n)
  })

  it('marks read scoped to the caller and echoes the result', async () => {
    const { controller, service } = makeController()
    const result = await controller.markRead(CTX, 'N1', { read: true })
    expect(result).toEqual({ publicId: 'N1', read: true })
    expect(service.markRead).toHaveBeenCalledWith(1n, 'N1', true)
  })

  it('can unmark as unread', async () => {
    const { controller, service } = makeController()
    await controller.markRead(CTX, 'N1', { read: false })
    expect(service.markRead).toHaveBeenCalledWith(1n, 'N1', false)
  })
})
