import { Body, Controller, Get, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AdminLevels, AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { SettingsService } from './settings.service'

const UpdateSettingSchema = z.object({
  settingKey: z.string().min(1).max(100),
  value: z.union([z.number(), z.string(), z.boolean()]),
})

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Tunables needed by clients (timeouts, limits). Any authenticated user. */
  @Get()
  getAll(@CurrentUser() _auth: AuthContext) {
    return this.settings.getAll()
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Platform settings: superadmin, super level only. */
  @Put()
  @Roles('superadmin')
  @AdminLevels('super')
  async update(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateSettingSchema)) body: { settingKey: string; value: unknown },
  ) {
    await this.settings.update(body.settingKey, body.value, auth.userId)
    return { settingKey: body.settingKey, value: body.value }
  }
}
