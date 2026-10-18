import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { AdminLevel, Role } from '@ride-master/shared'
import { randomToken, sha256Hex } from '../../common/utils/crypto'

export interface AccessTokenPayload {
  sub: string // user public_id
  sid: string // session public_id
  roles: Role[]
  activeRole: Role
  companyId?: string // company public_id
  adminLevel?: AdminLevel
}

export interface AdminPreAuthPayload {
  purpose: 'admin_pre_2fa'
  email: string
}

export interface IssuedTokenPair {
  accessToken: string
  refreshToken: string
  refreshTokenHash: string
}

/**
 * Access tokens: short-lived JWT (15 min default).
 * Refresh tokens: opaque 64-byte random strings, stored as SHA-256 hashes,
 * rotated on every refresh (see AuthService.refresh).
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, {
      expiresIn: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    })
  }

  /** 5-minute token proving the password step succeeded, before TOTP. */
  signAdminPreAuth(email: string): string {
    const payload: AdminPreAuthPayload = { purpose: 'admin_pre_2fa', email }
    return this.jwt.sign(payload, { expiresIn: '5m' })
  }

  verifyAdminPreAuth(token: string): AdminPreAuthPayload {
    const payload = this.jwt.verify<AdminPreAuthPayload>(token)
    if (payload.purpose !== 'admin_pre_2fa') {
      throw new Error('Not an admin pre-auth token')
    }
    return payload
  }

  newRefreshToken(): IssuedTokenPair['refreshToken'] {
    return randomToken(48)
  }

  hashRefreshToken(token: string): string {
    return sha256Hex(token)
  }
}
