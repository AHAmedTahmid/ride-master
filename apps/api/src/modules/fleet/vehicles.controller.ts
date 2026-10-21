import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateVehicleSchema, UpdateVehicleSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { VehiclesService } from './vehicles.service'

@ApiTags('fleet')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  /** company_owner (own fleet) and superadmin (?company= required for admins). */
  @Get()
  @Roles('company_owner', 'superadmin')
  list(@CurrentUser() auth: AuthContext, @Query('company') company?: string) {
    return this.vehicles.list(auth, company)
  }

  @Post()
  @Roles('company_owner', 'superadmin')
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateVehicleSchema))
    body: Parameters<VehiclesService['create']>[1],
    @Query('company') company?: string,
  ) {
    return this.vehicles.create(auth, body, company)
  }

  @Patch(':publicId')
  @Roles('company_owner', 'superadmin')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateVehicleSchema))
    body: Parameters<VehiclesService['update']>[2],
    @Query('company') company?: string,
  ) {
    return this.vehicles.update(auth, publicId, body, company)
  }

  /** Soft-deletes the vehicle (blocked while it has an open assignment). */
  @Delete(':publicId')
  @Roles('company_owner', 'superadmin')
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Query('company') company?: string,
  ) {
    return this.vehicles.remove(auth, publicId, company)
  }
}
