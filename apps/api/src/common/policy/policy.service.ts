import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AuthContext } from '../decorators/auth.decorators'
import { PrismaService } from '../../database/prisma.service'

/**
 * Policy layer — the single place that answers "may this actor touch this
 * record?". Guards check *what role* you have; policies check *whose record*
 * it is. Every company-scoped query must go through here.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma?: PrismaService) {}
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

  /**
   * Target company for fleet/pricing operations (vehicles, drivers, fares):
   * - company roles act on their own company; an explicit ?company= public id
   *   must match their own (or 403 — no silent cross-company writes).
   * - superadmins must name the company explicitly — there is never a
   *   default company for an admin request.
   * Never accepts a company id from a request body.
   */
  async resolveTargetCompanyId(auth: AuthContext, companyPublicId?: string): Promise<bigint> {
    if (auth.activeRole === 'superadmin') {
      if (!companyPublicId) {
        throw new BadRequestException('company query parameter is required for superadmin requests')
      }
      if (!this.prisma) throw new Error('PolicyService requires PrismaService')
      const company = await this.prisma.company.findFirst({
        where: { publicId: companyPublicId, deletedAt: null },
        select: { id: true },
      })
      if (!company) throw new NotFoundException('Company not found')
      return company.id
    }

    const own = this.resolveCompanyId(auth)
    if (companyPublicId && companyPublicId !== auth.companyPublicId) {
      throw new ForbiddenException('You cannot access another company\u2019s data')
    }
    return own
  }
}
