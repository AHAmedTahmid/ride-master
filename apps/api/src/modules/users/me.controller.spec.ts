import { describe, expect, it, vi } from 'vitest'
import { MeController } from './me.controller'

function makeController(user: unknown = null, authSvc: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async () => ({})),
    },
  }
  const auth = {
    switchRole: vi.fn(async () => ({ accessToken: 'new-at', user: { activeRole: 'driver' } })),
    ...authSvc,
  }
  return { controller: new MeController(prisma as never, auth as never), prisma, auth }
}

const CTX = {
  userId: 1n,
  userPublicId: 'U1',
  sessionId: 10n,
  sessionPublicId: 'S1',
  activeRole: 'rider' as const,
}

describe('MeController', () => {
  it('returns the profile with roles and company scope', async () => {
    const { controller } = makeController({
      publicId: 'U1',
      fullName: 'Rider One',
      phone: '+9607712345',
      email: null,
      language: 'en',
      roles: [
        {
          role: 'company_owner',
          adminLevel: null,
          company: { publicId: 'CO1', name: 'Azure Cabs', type: 'company', status: 'approved' },
        },
      ],
    })
    const result = await controller.me({ ...CTX, activeRole: 'company_owner' })
    expect(result).toMatchObject({
      publicId: 'U1',
      activeRole: 'company_owner',
      roles: [
        {
          role: 'company_owner',
          company: { publicId: 'CO1', name: 'Azure Cabs' },
        },
      ],
    })
  })

  it('null for a deleted user (guard normally rejects first)', async () => {
    const { controller } = makeController(null)
    expect(await controller.me(CTX)).toBeNull()
  })

  it('switchRole passes the session ids and body role', async () => {
    const { controller, auth } = makeController()
    await controller.switchRole(CTX, { role: 'driver', companyId: 'CO1' })
    expect(auth.switchRole).toHaveBeenCalledWith({
      userId: 1n,
      sessionId: 10n,
      role: 'driver',
      companyId: 'CO1',
    })
  })

  it('setLanguage persists and echoes the preference', async () => {
    const { controller, prisma } = makeController()
    const result = await controller.setLanguage(CTX, { language: 'dv' })
    expect(result).toEqual({ language: 'dv' })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { language: 'dv' },
    })
  })
})
