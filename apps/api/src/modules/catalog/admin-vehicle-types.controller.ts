import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateVehicleTypeSchema, UpdateVehicleTypeSchema } from '@ride-master/shared'
import {
  AdminLevels,
  AuthContext,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { VehicleTypesService } from './vehicle-types.service'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/vehicle-types')
@Roles('superadmin')
@AdminLevels('super')
export class AdminVehicleTypesController {
  constructor(private readonly vehicleTypes: VehicleTypesService) {}

  @Get()
  list() {
    return this.vehicleTypes.list()
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateVehicleTypeSchema))
    body: Parameters<VehicleTypesService['create']>[1],
  ) {
    return this.vehicleTypes.create(auth, body)
  }

  @Patch(':publicId')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateVehicleTypeSchema))
    body: Parameters<VehicleTypesService['update']>[2],
  ) {
    return this.vehicleTypes.update(auth, publicId, body)
  }

  @Delete(':publicId')
  remove(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.vehicleTypes.remove(auth, publicId)
  }
}
