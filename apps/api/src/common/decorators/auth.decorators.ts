import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AdminLevel, Role } from '@ride-master/shared'

export const IS_PUBLIC_KEY = 'isPublic'
export const ROLES_KEY = 'requiredRoles'
export const ADMIN_LEVELS_KEY = 'requiredAdminLevels'

/** Marks a route as accessible without a JWT (health, auth entry points). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

/** Restricts a route to the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)

/** Restricts a route to the listed superadmin levels (implies superadmin role). */
export const AdminLevels = (...levels: AdminLevel[]) => SetMetadata(ADMIN_LEVELS_KEY, levels)

/**
 * Authenticated identity attached by JwtAuthGuard.
 * companyId is resolved from the session's active role row, never from the request.
 */
export interface AuthContext {
  userId: bigint
  userPublicId: string
  fullName: string
  phone: string
  language: string
  sessionId: bigint
  sessionPublicId: string
  roles: Role[]
  activeRole: Role
  adminLevel?: AdminLevel
  companyPublicId?: string
  companyId?: bigint
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest()
    return request.user as AuthContext
  },
)
