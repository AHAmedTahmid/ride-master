import { Body, Controller, Get, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { SwitchRoleSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { PrismaService } from '../../database/prisma.service'
import { AuthService } from '../auth/auth.service'

const LanguageSchema = z.object({ language: z.enum(['en', 'dv']) })

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Profile, roles, active role and linked company for the current session. */
  @Get()
  async me(@CurrentUser() ctx: AuthContext) {
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      include: {
        roles: {
          where: { status: 'active' },
          include: {
            company: { select: { publicId: true, name: true, type: true, status: true } },
          },
        },
      },
    })
    if (!user) return null
    return {
      publicId: user.publicId,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      language: user.language,
      activeRole: ctx.activeRole,
      adminLevel: ctx.adminLevel,
      roles: user.roles.map((r) => ({
        role: r.role,
        adminLevel: r.adminLevel,
        company: r.company
          ? {
              publicId: r.company.publicId,
              name: r.company.name,
              type: r.company.type,
              status: r.company.status,
            }
          : null,
      })),
    }
  }

  /** Switch the session's active role (re-issues the access token). */
  @Post('switch-role')
  switchRole(
    @CurrentUser() ctx: AuthContext,
    @Body(new ZodValidationPipe(SwitchRoleSchema))
    body: { role: 'superadmin' | 'company_owner' | 'driver' | 'rider'; companyId?: string },
  ) {
    return this.auth.switchRole({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      role: body.role,
      companyId: body.companyId,
    })
  }

  /** Persist the UI language preference. */
  @Patch('language')
  async setLanguage(
    @CurrentUser() ctx: AuthContext,
    @Body(new ZodValidationPipe(LanguageSchema)) body: { language: 'en' | 'dv' },
  ) {
    await this.prisma.user.update({
      where: { id: ctx.userId },
      data: { language: body.language },
    })
    return { language: body.language }
  }
}
