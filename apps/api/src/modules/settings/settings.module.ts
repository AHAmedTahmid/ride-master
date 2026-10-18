import { Module } from '@nestjs/common'
import { SettingsService } from './settings.service'
import { SettingsController, AdminSettingsController } from './settings.controller'

@Module({
  providers: [SettingsService],
  controllers: [SettingsController, AdminSettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
