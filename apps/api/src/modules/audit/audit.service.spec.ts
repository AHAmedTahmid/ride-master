import { describe, expect, it, vi } from 'vitest'
import { AuditService } from './audit.service'

describe('AuditService', () => {
  it('writes an audit row with actor, action and JSON payloads', async () => {
    const create = vi.fn(async () => undefined)
    const service = new AuditService({ auditLog: { create } } as never)

    await service.log({
      actorUserId: 5n,
      action: 'COMPANY_APPROVED',
      entityType: 'company',
      entityId: 'C1',
      oldValue: { status: 'pending' },
      newValue: { status: 'approved' },
      ip: '127.0.0.1',
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publicId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        actorUserId: 5n,
        action: 'COMPANY_APPROVED',
        entityType: 'company',
        entityId: 'C1',
        oldValue: { status: 'pending' },
        newValue: { status: 'approved' },
        ipAddress: '127.0.0.1',
      }),
    })
  })

  it('tolerates missing optional fields', async () => {
    const create = vi.fn(async () => undefined)
    const service = new AuditService({ auditLog: { create } } as never)
    await service.log({ action: 'LOGOUT', entityType: 'session' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: null,
          entityId: null,
          oldValue: undefined,
          newValue: undefined,
        }),
      }),
    )
  })

  it('never masks the original action when the audit write fails', async () => {
    const create = vi.fn(async () => {
      throw new Error('db down')
    })
    const service = new AuditService({ auditLog: { create } } as never)
    // The failure is logged, not thrown — the caller's action must proceed.
    await expect(service.log({ action: 'LOGOUT', entityType: 'session' })).resolves.toBeUndefined()
    expect(create).toHaveBeenCalled()
  })
})
