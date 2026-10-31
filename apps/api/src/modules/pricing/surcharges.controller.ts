import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateSurchargeSchema, UpdateSurchargeSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { SurchargesService } from './surcharges.service'

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('surcharges')
export class SurchargesController {
  constructor(private readonly surcharges: SurchargesService) {}

  @Get()
  @Roles('company_owner', 'superadmin')
  list(@CurrentUser() auth: AuthContext, @Query('company') company?: string) {
    return this.surcharges.list(auth, company)
  }

  @Post()
  @Roles('company_owner', 'superadmin')
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateSurchargeSchema))
    body: Parameters<SurchargesService['create']>[1],
    @Query('company') company?: string,
  ) {
    return this.surcharges.create(auth, body, company)
  }

  @Patch(':publicId')
  @Roles('company_owner', 'superadmin')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateSurchargeSchema))
    body: Parameters<SurchargesService['update']>[2],
    @Query('company') company?: string,
  ) {
    return this.surcharges.update(auth, publicId, body, company)
  }

  @Delete(':publicId')
  @Roles('company_owner', 'superadmin')
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Query('company') company?: string,
  ) {
    return this.surcharges.remove(auth, publicId, company)
  }
}
