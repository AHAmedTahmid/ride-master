import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthContext, ROLES_KEY, ADMIN_LEVELS_KEY } from '../decorators/auth.decorators'
import { AdminLevelGuard, RolesGuard } from './auth.guards'

function makeAuth(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: 1n,
    userPublicId: 'U1',
    fullName: 'Test',
    phone: '+9607712345',
    language: 'en',
    sessionId: 1n,
    sessionPublicId: 'S1',
    roles: ['rider'],
    activeRole: 'rider',
    ...overrides,
  }
}

function makeContext(user: AuthContext | undefined, meta: Record<string, unknown>) {
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector
  const request = { user }
  return {
    reflector,
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  }
}

describe('RolesGuard', () => {
  let guard: RolesGuard

  beforeEach(() => {
    guard = new RolesGuard(null as never)
  })

  it('allows any authenticated role when no roles are required', () => {
    const { reflector, context } = makeContext(makeAuth({}), {})
    guard = new RolesGuard(reflector)
    expect(guard.canActivate(context)).toBe(true)
  })

  it('rejects unauthenticated requests', () => {
    const { reflector, context } = makeContext(undefined, { [ROLES_KEY]: ['rider'] })
    guard = new RolesGuard(reflector)
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('allows a matching role', () => {
    const { reflector, context } = makeContext(makeAuth({ activeRole: 'rider', roles: ['rider'] }), {
      [ROLES_KEY]: ['rider'],
    })
    guard = new RolesGuard(reflector)
    expect(guard.canActivate(context)).toBe(true)
  })

  it('rejects a non-matching role with 403 and states both roles', () => {
    const { reflector, context } = makeContext(
      makeAuth({ activeRole: 'rider', roles: ['rider'] }),
      { [ROLES_KEY]: ['superadmin'] },
    )
    guard = new RolesGuard(reflector)
    expect(() => guard.canActivate(context)).toThrowError(
      /requires role: superadmin\. Active role: rider/,
    )
  })

  it('permission matrix: every declared combination', () => {
    const matrix: Array<[AuthContext['activeRole'], string[], boolean]> = [
      ['rider', ['rider'], true],
      ['rider', ['driver'], false],
      ['driver', ['driver'], true],
      ['driver', ['rider', 'driver'], true],
      ['driver', ['superadmin'], false],
      ['company_owner', ['company_owner'], true],
      ['company_owner', ['superadmin'], false],
      ['superadmin', ['superadmin'], true],
      ['superadmin', ['rider'], false],
    ]
    for (const [activeRole, required, allowed] of matrix) {
      const { reflector, context } = makeContext(makeAuth({ activeRole }), {
        [ROLES_KEY]: required,
      })
      guard = new RolesGuard(reflector)
      if (allowed) {
        expect(guard.canActivate(context), `${activeRole} in ${required}`).toBe(true)
      } else {
        expect(() => guard.canActivate(context), `${activeRole} not in ${required}`).toThrow(
          ForbiddenException,
        )
      }
    }
  })
})

describe('AdminLevelGuard', () => {
  let guard: AdminLevelGuard

  beforeEach(() => {
    guard = new AdminLevelGuard(null as never)
  })

  it('allows any role when no levels are required', () => {
    const { reflector, context } = makeContext(makeAuth({}), {})
    guard = new AdminLevelGuard(reflector)
    expect(guard.canActivate(context)).toBe(true)
  })

  it('rejects unauthenticated requests', () => {
    const { reflector, context } = makeContext(undefined, { [ADMIN_LEVELS_KEY]: ['super'] })
    guard = new AdminLevelGuard(reflector)
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects non-superadmin roles even with a matching level name', () => {
    const { reflector, context } = makeContext(makeAuth({ activeRole: 'rider' }), {
      [ADMIN_LEVELS_KEY]: ['super'],
    })
    guard = new AdminLevelGuard(reflector)
    expect(() => guard.canActivate(context)).toThrow(/Superadmin access required/)
  })

  it('permission matrix over admin levels', () => {
    const matrix: Array<[string | undefined, string[], boolean]> = [
      ['super', ['super'], true],
      ['super', ['verifier'], true], // 'super' always passes
      ['verifier', ['super'], false],
      ['verifier', ['verifier'], true],
      ['verifier', ['finance'], false],
      ['support', ['support'], true],
      ['support', ['super', 'support'], true],
      ['finance', ['finance'], true],
      [undefined, ['super'], false],
    ]
    for (const [adminLevel, required, allowed] of matrix) {
      const { reflector, context } = makeContext(
        makeAuth({ activeRole: 'superadmin', adminLevel: adminLevel as never }),
        { [ADMIN_LEVELS_KEY]: required },
      )
      guard = new AdminLevelGuard(reflector)
      if (allowed) {
        expect(guard.canActivate(context), `${adminLevel} in ${required}`).toBe(true)
      } else {
        expect(() => guard.canActivate(context), `${adminLevel} not in ${required}`).toThrow(
          ForbiddenException,
        )
      }
    }
  })
})
