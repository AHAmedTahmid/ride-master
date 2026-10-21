import { Module } from '@nestjs/common'
import { SettingsModule } from '../settings/settings.module'
import { VehiclesController } from './vehicles.controller'
import { VehiclesService } from './vehicles.service'
import { DriversController } from './drivers.controller'
import { DriversService } from './drivers.service'

@Module({
  imports: [SettingsModule],
  controllers: [VehiclesController, DriversController],
  providers: [VehiclesService, DriversService],
  exports: [VehiclesService, DriversService],
})
export class FleetModule {}
