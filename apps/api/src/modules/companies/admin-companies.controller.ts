import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { RejectCompanySchema, SuspendCompanySchema } from '@ride-master/shared'
import {
  AdminLevels,
  AuthContext,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { AdminCompaniesService } from './admin-companies.service'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/companies')
export class AdminCompaniesController {
  constructor(private readonly adminCompanies: AdminCompaniesService) {}

  /** Approval queue: verifier and super levels only. */
  @Get()
  @Roles('superadmin')
  @AdminLevels('verifier', 'super')
  list(@Query('status') status?: string, @Query('page') page = '1', @Query('limit') limit = '50') {
    return this.adminCompanies.list({
      status,
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(200, Math.max(1, parseInt(limit, 10) || 50)),
    })
  }

  /** Review detail with 10-minute signed document URLs. */
  @Get(':publicId')
  @Roles('superadmin')
  @AdminLevels('verifier', 'super')
  detail(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.adminCompanies.detail(auth, publicId)
  }

  @Post(':publicId/approve')
  @Roles('superadmin')
  @AdminLevels('verifier', 'super')
  approve(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.adminCompanies.approve(auth, publicId)
  }

  @Post(':publicId/reject')
  @Roles('superadmin')
  @AdminLevels('verifier', 'super')
  reject(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(RejectCompanySchema)) body: { reason: string },
  ) {
    return this.adminCompanies.reject(auth, publicId, body)
  }

  /** Suspension revokes every owner/driver session immediately — super only. */
  @Post(':publicId/suspend')
  @Roles('superadmin')
  @AdminLevels('super')
  suspend(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(SuspendCompanySchema)) body: { reason: string },
  ) {
    return this.adminCompanies.suspend(auth, publicId, body)
  }

  @Post(':publicId/resume')
  @Roles('superadmin')
  @AdminLevels('super')
  resume(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.adminCompanies.resume(auth, publicId)
  }
}
