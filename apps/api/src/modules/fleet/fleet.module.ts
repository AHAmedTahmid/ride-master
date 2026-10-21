import { Module } from '@nestjs/common'
import { SettingsModule } from '../settings/settings.module'
import { VehiclesController } from './vehicles.controller'
import { VehiclesService } from './vehicles.service'

@Module({
  imports: [SettingsModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class FleetModule {}
