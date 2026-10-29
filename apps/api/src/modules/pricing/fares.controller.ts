import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateFareSchema, ImportSuggestedFareSchema, UpdateFareSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { FaresService } from './fares.service'

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('fares')
export class FaresController {
  constructor(private readonly fares: FaresService) {}

  /** company_owner (own fares) and superadmin (?company= required for admins). */
  @Get()
  @Roles('company_owner', 'superadmin')
  list(@CurrentUser() auth: AuthContext, @Query('company') company?: string) {
    return this.fares.list(auth, company)
  }

  @Post()
  @Roles('company_owner', 'superadmin')
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateFareSchema)) body: Parameters<FaresService['create']>[1],
    @Query('company') company?: string,
  ) {
    return this.fares.create(auth, body, company)
  }

  /** One-tap import of a platform suggested fare as this company's fare. */
  @Post('from-suggested')
  @Roles('company_owner', 'superadmin')
  fromSuggested(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ImportSuggestedFareSchema))
    body: Parameters<FaresService['fromSuggested']>[1],
    @Query('company') company?: string,
  ) {
    return this.fares.fromSuggested(auth, body, company)
  }

  @Patch(':publicId')
  @Roles('company_owner', 'superadmin')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateFareSchema)) body: Parameters<FaresService['update']>[2],
    @Query('company') company?: string,
  ) {
    return this.fares.update(auth, publicId, body, company)
  }

  @Delete(':publicId')
  @Roles('company_owner', 'superadmin')
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Query('company') company?: string,
  ) {
    return this.fares.remove(auth, publicId, company)
  }
}
