import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateDriverSchema, CreateAssignmentSchema, UpdateDriverSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { DriversService } from './drivers.service'

@ApiTags('fleet')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /** company_owner (own drivers) and superadmin (?company= required for admins). */
  @Get()
  @Roles('company_owner', 'superadmin')
  list(@CurrentUser() auth: AuthContext, @Query('company') company?: string) {
    return this.drivers.list(auth, company)
  }

  @Post()
  @Roles('company_owner', 'superadmin')
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateDriverSchema)) body: Parameters<DriversService['create']>[1],
    @Query('company') company?: string,
  ) {
    return this.drivers.create(auth, body, company)
  }

  @Patch(':publicId')
  @Roles('company_owner', 'superadmin')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateDriverSchema)) body: Parameters<DriversService['update']>[2],
    @Query('company') company?: string,
  ) {
    return this.drivers.update(auth, publicId, body, company)
  }

  @Delete(':publicId')
  @Roles('company_owner', 'superadmin')
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Query('company') company?: string,
  ) {
    return this.drivers.remove(auth, publicId, company)
  }

  @Post(':publicId/assignments')
  @Roles('company_owner', 'superadmin')
  assign(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(CreateAssignmentSchema))
    body: Parameters<DriversService['assign']>[2],
    @Query('company') company?: string,
  ) {
    return this.drivers.assign(auth, publicId, body, company)
  }

  @Delete(':publicId/assignments/:assignmentPublicId')
  @Roles('company_owner', 'superadmin')
  unassign(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Param('assignmentPublicId') assignmentPublicId: string,
    @Query('company') company?: string,
  ) {
    return this.drivers.unassign(auth, publicId, assignmentPublicId, company)
  }
}
