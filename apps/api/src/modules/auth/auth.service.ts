import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { Prisma } from '@prisma/client'
import type { AdminLevel, Role } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { generateUlid } from '../../common/utils/ulid'
import { normalizePhone } from '../../common/utils/phone'
import { decryptSecret, encryptSecret } from '../../common/utils/crypto'
import { AuditService } from '../audit/audit.service'
import { TokenService } from './token.service'
import { OtpService, OtpPurpose } from './otp.service'
import { TotpService } from './totp.service'

export const REFRESH_COOKIE = 'rm_refresh'

export interface AuthTokens {
  accessToken: string
  /** Payload mirror so the client can render without a second call. */
  user: {
    publicId: string
    fullName: string
    phone: string
    language: string
    roles: Role[]
    activeRole: Role
    adminLevel?: AdminLevel
    companyPublicId?: string
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
  ) {}

  // ── Phone OTP ───────────────────────────────────────────────────────────────

  async requestOtp(phone: string, purpose: OtpPurpose) {
    return this.otp.requestOtp(phone, purpose)
  }

  /**
   * Verify OTP and establish a session.
   * - purpose 'login': the phone must already have an account with a role.
   * - purpose 'register': a rider account is created if none exists.
   * A driver logging in has other sessions revoked (single-session rule).
   */
  async verifyOtp(params: {
    phone: string
    code: string
    purpose: OtpPurpose
    ip?: string
    deviceInfo?: Record<string, unknown>
  }): Promise<AuthTokens & { refreshToken: string }> {
    const phone = normalizePhone(params.phone)
    const ok = await this.otp.verifyOtp(phone, params.code, params.purpose)
    if (!ok) throw new UnauthorizedException('Invalid or expired code')

    let user = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: { where: { status: 'active' } } },
    })

    if (!user) {
      if (params.purpose !== 'register') {
        throw new UnauthorizedException('No account for this number. Register first.')
      }
      user = await this.prisma.user.create({
        data: {
          publicId: generateUlid(),
          fullName: 'Rider', // rider supplies their name in profile (Phase 4)
          phone,
          language: 'en',
          roles: { create: { publicId: generateUlid(), role: 'rider' } },
        },
        include: { roles: { where: { status: 'active' } } },
      })
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Account is suspended')
    }

    const activeRole = (user.roles[0]?.role as Role) ?? 'rider'
    const roleRow = user.roles.find((r) => r.role === activeRole)
    if (!roleRow) throw new ForbiddenException('Account has no active role')

    // Multi-role users default to the first role; the client switches after login.
    const tokens = await this.issueSession(user.id, roleRow.id, {
      publicId: user.publicId,
      fullName: user.fullName,
      phone: user.phone,
      language: user.language,
      roles: user.roles.map((r) => r.role as Role),
      activeRole,
    }, user.roles.some((r) => r.role === 'driver'), params.ip, params.deviceInfo)

    await this.audit.log({
      actorUserId: user.id,
      action: 'LOGIN_OTP',
      entityType: 'user',
      entityId: user.publicId,
      ip: params.ip,
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return tokens
  }

  // ── Superadmin password + TOTP ──────────────────────────────────────────────

  /** Step 1: password. Returns a short-lived preAuthToken for the TOTP step. */
  async adminLogin(email: string, password: string, ip?: string): Promise<{ preAuthToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { where: { role: 'superadmin', status: 'active' } } },
    })

    const invalid = new UnauthorizedException('Invalid email or password')
    if (!user || !user.passwordHash || user.status !== 'active') throw invalid
    if (user.roles.length === 0) throw invalid

    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      await this.audit.log({
        actorUserId: user.id,
        action: 'LOGIN_ADMIN',
        entityType: 'user',
        entityId: user.publicId,
        newValue: { result: 'bad_password' },
        ip,
      })
      throw invalid
    }

    return { preAuthToken: this.tokens.signAdminPreAuth(email) }
  }

  /** Step 2: TOTP. Completes the login and issues the token pair. */
  async adminVerifyTotp(params: {
    email: string
    totpToken: string
    preAuthToken: string
    ip?: string
    deviceInfo?: Record<string, unknown>
  }): Promise<AuthTokens & { refreshToken: string }> {
    let email: string
    try {
      email = this.tokens.verifyAdminPreAuth(params.preAuthToken).email
    } catch {
      throw new UnauthorizedException('Pre-auth token invalid or expired')
    }
    if (email !== params.email) {
      throw new UnauthorizedException('Pre-auth token does not match this email')
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { where: { role: 'superadmin', status: 'active' } } },
    })
    if (!user || !user.totpSecretEnc || user.status !== 'active' || user.roles.length === 0) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const secret = decryptSecret(user.totpSecretEnc)
    if (!this.totp.verify(params.totpToken, secret)) {
      await this.audit.log({
        actorUserId: user.id,
        action: 'LOGIN_ADMIN',
        entityType: 'user',
        entityId: user.publicId,
        newValue: { result: 'bad_totp' },
        ip: params.ip,
      })
      throw new UnauthorizedException('Invalid authentication code')
    }

    const roleRow = user.roles[0]
    const tokens = await this.issueSession(
      user.id,
      roleRow.id,
      {
        publicId: user.publicId,
        fullName: user.fullName,
        phone: user.phone,
        language: user.language,
        roles: ['superadmin'],
        activeRole: 'superadmin',
        adminLevel: roleRow.adminLevel as AdminLevel,
      },
      false,
      params.ip,
      params.deviceInfo,
    )

    await this.audit.log({
      actorUserId: user.id,
      action: 'LOGIN_ADMIN',
      entityType: 'user',
      entityId: user.publicId,
      newValue: { result: 'success' },
      ip: params.ip,
    })
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    return tokens
  }

  // ── Session lifecycle ───────────────────────────────────────────────────────

  /** Step 1.5 used by tests and ops: provision TOTP for an admin account. */
  async provisionTotp(userPublicId: string): Promise<{ otpauthUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where: { publicId: userPublicId },
      include: { roles: { where: { role: 'superadmin' } } },
    })
    if (!user || user.roles.length === 0) {
      throw new ForbiddenException('Not a superadmin account')
    }
    const { secret, otpauthUrl } = this.totp.generateSecret(user.email ?? user.publicId)
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: encryptSecret(secret) },
    })
    return { otpauthUrl }
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokens & { refreshToken: string }> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token')

    const hash = this.tokens.hashRefreshToken(refreshToken)
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: {
        user: { include: { roles: { where: { status: 'active' } } } },
        userRole: true,
      },
    })
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired')
    }
    if (session.user.status !== 'active' || session.user.deletedAt !== null) {
      throw new UnauthorizedException('Account is not active')
    }

    const activeRole = session.userRole.role as Role
    const roleRow = session.user.roles.find((r) => r.id === session.userRoleId)
    if (!roleRow) throw new UnauthorizedException('Role is no longer active')

    // Rotate: new token, new hash, sliding expiry. Old token becomes invalid.
    const newToken = this.tokens.newRefreshToken()
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.tokens.hashRefreshToken(newToken),
        expiresAt: this.refreshExpiry(),
      },
    })

    return {
      accessToken: this.buildAccessFromSession(session.user, roleRow, session.publicId, activeRole),
      refreshToken: newToken,
      user: this.userMirror(session.user, roleRow, activeRole),
    }
  }

  async logout(sessionPublicId: string, userPublicId: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } })
    await this.prisma.session.updateMany({
      where: { publicId: sessionPublicId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (user) {
      await this.audit.log({
        actorUserId: user.id,
        action: 'LOGOUT',
        entityType: 'session',
        entityId: sessionPublicId,
        ip,
      })
    }
  }

  /**
   * Switch the active role of the current session (re-issues the access
   * token and pins the new role on the session so refresh keeps it).
   */
  async switchRole(params: {
    userId: bigint
    sessionId: bigint
    role: Role
    companyId?: string
  }): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      include: { roles: { where: { status: 'active' } } },
    })
    if (!user) throw new UnauthorizedException('Account not found')

    const roleRow = user.roles.find((r) => r.role === params.role)
    if (!roleRow) throw new ForbiddenException(`Role '${params.role}' is not active`)

    if ((params.role === 'company_owner' || params.role === 'driver') && params.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { publicId: params.companyId, deletedAt: null },
      })
      if (!company || roleRow.companyId !== company.id) {
        throw new ForbiddenException('Company does not belong to this account')
      }
    }
    if (roleRow.companyId) {
      const company = await this.prisma.company.findFirst({ where: { id: roleRow.companyId } })
      if (!company) throw new ForbiddenException('Company link is broken')
    }

    await this.prisma.session.update({
      where: { id: params.sessionId },
      data: { userRoleId: roleRow.id },
    })

    const session = await this.prisma.session.findUnique({ where: { id: params.sessionId } })
    const adminLevel =
      params.role === 'superadmin' ? (roleRow.adminLevel as AdminLevel) : undefined

    return {
      accessToken: this.buildAccessFromSession(
        user,
        roleRow,
        session?.publicId ?? '',
        params.role,
        adminLevel,
      ),
      user: this.userMirror(user, roleRow, params.role, adminLevel),
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private refreshExpiry(): Date {
    const days = parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '7', 10)
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  private async issueSession(
    userId: bigint,
    userRoleId: bigint,
    user: AuthTokens['user'],
    isDriver: boolean,
    ip?: string,
    deviceInfo?: Record<string, unknown>,
  ): Promise<AuthTokens & { refreshToken: string }> {
    // Single-session rule: a driver login signs out every other device.
    if (isDriver) {
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }

    const refreshToken = this.tokens.newRefreshToken()
    const session = await this.prisma.session.create({
      data: {
        publicId: generateUlid(),
        userId,
        userRoleId,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        deviceInfo: (deviceInfo as Prisma.InputJsonObject) ?? undefined,
        ipAddress: ip ?? null,
        expiresAt: this.refreshExpiry(),
      },
    })

    const roleRow = await this.prisma.userRole.findUnique({ where: { id: userRoleId } })
    let companyPublicId: string | undefined
    if (roleRow?.companyId) {
      const company = await this.prisma.company.findUnique({
        where: { id: roleRow.companyId },
        select: { publicId: true },
      })
      companyPublicId = company?.publicId
    }

    const accessToken = this.tokens.signAccess({
      sub: user.publicId,
      sid: session.publicId,
      roles: user.roles,
      activeRole: user.activeRole,
      ...(companyPublicId ? { companyId: companyPublicId } : {}),
      ...(user.adminLevel ? { adminLevel: user.adminLevel } : {}),
    })

    return {
      accessToken,
      refreshToken,
      user: { ...user, ...(companyPublicId ? { companyPublicId } : {}) },
    }
  }

  private buildAccessFromSession(
    user: { publicId: string },
    roleRow: { role: string; companyId: bigint | null; adminLevel: string | null },
    sessionPublicId: string,
    activeRole: Role,
    adminLevelOverride?: AdminLevel,
  ): string {
    // companyId claim uses public id — resolved synchronously by caller when needed.
    const payload: Parameters<TokenService['signAccess']>[0] = {
      sub: user.publicId,
      sid: sessionPublicId,
      roles: [activeRole],
      activeRole,
    }
    const level = adminLevelOverride ?? (roleRow.adminLevel as AdminLevel | null)
    if (activeRole === 'superadmin' && level) payload.adminLevel = level
    return this.tokens.signAccess(payload)
  }

  private userMirror(
    user: { publicId: string; fullName: string; phone: string; language: string },
    roleRow: { role: string; companyId: bigint | null; adminLevel: string | null },
    activeRole: Role,
    adminLevelOverride?: AdminLevel,
  ): AuthTokens['user'] {
    const mirror: AuthTokens['user'] = {
      publicId: user.publicId,
      fullName: user.fullName,
      phone: user.phone,
      language: user.language,
      roles: [activeRole],
      activeRole,
    }
    if (activeRole === 'superadmin') {
      mirror.adminLevel = adminLevelOverride ?? (roleRow.adminLevel as AdminLevel | undefined)
    }
    return mirror
  }
}
