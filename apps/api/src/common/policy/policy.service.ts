import { ForbiddenException, Injectable } from '@nestjs/common'
import { AuthContext } from '../decorators/auth.decorators'

/**
 * Policy layer — the single place that answers "may this actor touch this
 * record?". Guards check *what role* you have; policies check *whose record*
 * it is. Every company-scoped query must go through here.
 */
@Injectable()
export class PolicyService {
  /**
   * Company owners and drivers may only act inside their own company.
   * Superadmins may act anywhere. Riders/other roles never pass.
   */
  requireCompanyScope(auth: AuthContext, companyPublicId: string): void {
    if (auth.activeRole === 'superadmin') return
    if (auth.activeRole === 'company_owner' || auth.activeRole === 'driver') {
      if (auth.companyPublicId && auth.companyPublicId === companyPublicId) return
      // 404-style silence is handled per-endpoint; default is explicit 403.
      throw new ForbiddenException('You cannot access another company’s data')
    }
    throw new ForbiddenException('Your role has no company scope')
  }

  /**
   * The trusted company id for scoping queries. Superadmin acting on a
   * specific company passes companyPublicId explicitly; everyone else gets
   * their own companyId from the session. Never accept company from the body.
   */
  resolveCompanyId(auth: AuthContext): bigint {
    if (!auth.companyId) {
      throw new ForbiddenException('Your account is not linked to a company')
    }
    return auth.companyId
  }

  /** A user may always act on their own record. */
  requireSelf(auth: AuthContext, userPublicId: string): void {
    if (auth.activeRole === 'superadmin') return
    if (auth.userPublicId !== userPublicId) {
      throw new ForbiddenException('You can only access your own records')
    }
  }

  /** Only superadmins (any level that owns settings) may change platform settings. */
  requireSuperadmin(auth: AuthContext): void {
    if (auth.activeRole !== 'superadmin') {
      throw new ForbiddenException('Superadmin access required')
    }
  }
}
