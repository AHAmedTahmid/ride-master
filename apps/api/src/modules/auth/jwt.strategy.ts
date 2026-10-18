import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { AdminLevel, Role } from '@ride-master/shared'

export interface JwtVerifiedPayload {
  sub: string
  sid: string
  roles: Role[]
  activeRole: Role
  companyId?: string
  adminLevel?: AdminLevel
}

/**
 * Verifies the access token only. Session revocation, user suspension and
 * role checks are enforced by JwtAuthGuard on every request (DB-backed).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'change_me_64_byte_hex',
    })
  }

  validate(payload: JwtVerifiedPayload): JwtVerifiedPayload {
    return payload
  }
}
