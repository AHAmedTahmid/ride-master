import { describe, expect, it, vi } from 'vitest'
import { AuditController } from './audit.controller'

function makeController(rows: unknown[] = [], total = rows.length) {
  const prisma = {
    auditLog: {
      count: vi.fn(async () => total),
      findMany: vi.fn(async () => rows),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { controller: new AuditController(prisma as never), prisma }
}

describe('AuditController', () => {
  it('maps rows to public actor ids — never internal BigInt ids', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    const { controller } = makeController([
      {
        publicId: 'A1',
        actor: { publicId: 'U1', fullName: 'Super Admin' },
        action: 'LOGIN_ADMIN',
        entityType: 'user',
        entityId: 'U1',
        oldValue: null,
        newValue: { result: 'success' },
        ipAddress: '127.0.0.1',
        requestId: 'req-1',
        createdAt,
      },
    ])
    const result = await controller.list()
    expect(result.data[0]).toEqual({
      publicId: 'A1',
      actorPublicId: 'U1',
      actorName: 'Super Admin',
      action: 'LOGIN_ADMIN',
      entityType: 'user',
      entityId: 'U1',
      oldValue: null,
      newValue: { result: 'success' },
      ipAddress: '127.0.0.1',
      requestId: 'req-1',
      createdAt: createdAt.toISOString(),
    })
    expect(result.data[0]).not.toHaveProperty('actorUserId')
  })

  it('handles rows with no actor (system actions)', async () => {
    const { controller } = makeController([
      {
        publicId: 'A2',
        actor: null,
        action: 'EXPIRY_SWEEP',
        entityType: 'booking',
        entityId: 'B1',
        oldValue: null,
        newValue: null,
        ipAddress: null,
        requestId: null,
        createdAt: new Date(),
      },
    ])
    const result = await controller.list()
    expect(result.data[0].actorPublicId).toBeNull()
    expect(result.data[0].actorName).toBeNull()
  })

  it('paginates and caps the limit', async () => {
    const { controller, prisma } = makeController([], 121)
    const result = await controller.list('2', '500')
    expect(result.meta).toEqual({ page: 2, limit: 200, total: 121, totalPages: 1 })
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 200, take: 200 }),
    )
  })

  it('passes filters through to the query', async () => {
    const { controller, prisma } = makeController()
    await controller.list('1', '10', 'LOGIN_OTP', 'user')
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'LOGIN_OTP', entityType: 'user' } }),
    )
  })
})
