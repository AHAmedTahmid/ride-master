import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import type { Role } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { ADMIN_LEVELS_KEY, AuthContext, IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators'

/**
 * Global authentication guard.
 *
 * 1. Verifies the access JWT (signature + expiry).
 * 2. Reloads the session from the database — logout, revocation and expiry
 *    take effect immediately, even with a valid JWT.
 * 3. Reloads the user and their active roles — a suspended user loses access
 *    on the very next request.
 * 4. Resolves the active role's company from user_roles (never from the
 *    request body), giving every downstream query a trusted company scope.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super()
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const activated = await super.canActivate(context)
    if (!activated) return false

    const request = context.switchToHttp().getRequest()
    const payload = request.user as { sub: string; sid: string; activeRole: Role }
    if (!payload?.sub || !payload?.sid) {
      throw new UnauthorizedException('Invalid token payload')
    }

    const auth = await this.buildAuthContext(payload.sub, payload.sid, payload.activeRole)
    request.user = auth
    return true
  }

  private async buildAuthContext(
    userPublicId: string,
    sessionPublicId: string,
    activeRole: Role,
  ): Promise<AuthContext> {
    const user = await this.prisma.user.findFirst({
      where: { publicId: userPublicId, status: 'active', deletedAt: null },
      include: {
        roles: { where: { status: 'active' } },
        sessions: { where: { publicId: sessionPublicId } },
      },
    })
    if (!user) throw new UnauthorizedException('Account is not active')
    if (user.roles.length === 0) throw new UnauthorizedException('Account has no active roles')

    const session = user.sessions[0]
    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer valid')
    }

    const roles = user.roles.map((r) => r.role as Role)
    if (!roles.includes(activeRole)) {
      throw new ForbiddenException(`Role '${activeRole}' is not active for this account`)
    }

    const roleRow = user.roles.find((r) => r.role === activeRole)
    const auth: AuthContext = {
      userId: user.id,
      userPublicId: user.publicId,
      fullName: user.fullName,
      phone: user.phone,
      language: user.language,
      sessionId: session.id,
      sessionPublicId: session.publicId,
      roles,
      activeRole,
    }

    if (activeRole === 'superadmin' && roleRow?.adminLevel) {
      auth.adminLevel = roleRow.adminLevel as AuthContext['adminLevel']
    }

    if ((activeRole === 'company_owner' || activeRole === 'driver') && roleRow?.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: roleRow.companyId, deletedAt: null },
      })
      if (company) {
        auth.companyId = company.id
        auth.companyPublicId = company.publicId
      }
    }

    return auth
  }
}

/** Requires the request user to hold one of the declared roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user as AuthContext | undefined
    if (!user) throw new UnauthorizedException('Not authenticated')
    if (!required.includes(user.activeRole)) {
      throw new ForbiddenException(
        `This action requires role: ${required.join(' or ')}. Active role: ${user.activeRole}`,
      )
    }
    return true
  }
}

/** Requires the declared superadmin levels (super, verifier, support, finance). */
@Injectable()
export class AdminLevelGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ADMIN_LEVELS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user as AuthContext | undefined
    if (!user) throw new UnauthorizedException('Not authenticated')
    if (user.activeRole !== 'superadmin') {
      throw new ForbiddenException('Superadmin access required')
    }
    // 'super' always passes: it is the all-powerful level.
    if (user.adminLevel === 'super' || (user.adminLevel && required.includes(user.adminLevel))) {
      return true
    }
    throw new ForbiddenException(`This action requires admin level: ${required.join(' or ')}`)
  }
}
