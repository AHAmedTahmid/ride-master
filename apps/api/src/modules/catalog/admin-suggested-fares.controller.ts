import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CreateSuggestedFareSchema, UpdateSuggestedFareSchema } from '@ride-master/shared'
import {
  AdminLevels,
  AuthContext,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { SuggestedFaresService } from './suggested-fares.service'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/suggested-fares')
@Roles('superadmin')
@AdminLevels('super')
export class AdminSuggestedFaresController {
  constructor(private readonly suggestedFares: SuggestedFaresService) {}

  @Get()
  list() {
    return this.suggestedFares.list()
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateSuggestedFareSchema))
    body: Parameters<SuggestedFaresService['create']>[1],
  ) {
    return this.suggestedFares.create(auth, body)
  }

  @Patch(':publicId')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('publicId') publicId: string,
    @Body(new ZodValidationPipe(UpdateSuggestedFareSchema))
    body: Parameters<SuggestedFaresService['update']>[2],
  ) {
    return this.suggestedFares.update(auth, publicId, body)
  }

  @Delete(':publicId')
  remove(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.suggestedFares.remove(auth, publicId)
  }
}
