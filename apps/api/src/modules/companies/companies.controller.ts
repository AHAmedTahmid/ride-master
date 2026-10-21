import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import {
  CreateCompanySchema,
  SetServiceAreasSchema,
  UpdateCompanySchema,
} from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { CompaniesService } from './companies.service'

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /**
   * Signup wizard submission (step "create company"). Re-issues the access
   * token pinned to company_owner so the wizard can continue logged in as
   * the owner.
   */
  @Post()
  @Roles('rider')
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateCompanySchema))
    body: Parameters<CompaniesService['create']>[1],
  ) {
    return this.companies.create(auth, body)
  }

  /** Owner dashboard: profile, documents, service areas, counts. */
  @Get('me')
  @Roles('company_owner')
  getMine(@CurrentUser() auth: AuthContext) {
    return this.companies.getMine(auth)
  }

  /** Profile edits; identity changes on an approved company re-enter review. */
  @Patch('me')
  @Roles('company_owner')
  updateMine(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateCompanySchema))
    body: Parameters<CompaniesService['updateMine']>[1],
  ) {
    return this.companies.updateMine(auth, body)
  }

  @Put('me/service-areas')
  @Roles('company_owner')
  setServiceAreas(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(SetServiceAreasSchema))
    body: Parameters<CompaniesService['setServiceAreas']>[1],
  ) {
    return this.companies.setServiceAreas(auth, body)
  }

  /** Rejected company resubmits into the approval queue. */
  @Post('me/submit')
  @Roles('company_owner')
  submit(@CurrentUser() auth: AuthContext) {
    return this.companies.submit(auth)
  }
}
