import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateAreaSchema, UpdateAreaSchema } from '@ride-master/shared'
import {
  AdminLevels,
  AuthContext,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { AreasService } from './areas.service'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/areas')
@Roles('superadmin')
@AdminLevels('super')
export class AdminAreasController {
  constructor(private readonly areas: AreasService) {}

  @Get()
  list() {
    return this.areas.list()
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateAreaSchema)) body: Parameters<AreasService['create']>[1],
  ) {
    return this.areas.create(auth, body)
  }

  @Patch(':publicId')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateAreaSchema)) body: Parameters<AreasService['update']>[2],
  ) {
    return this.areas.update(auth, publicId, body)
  }

  @Delete(':publicId')
  remove(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.areas.remove(auth, publicId)
  }
}
