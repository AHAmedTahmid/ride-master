import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { AdminAreasController } from './admin-areas.controller'
import { AdminSuggestedFaresController } from './admin-suggested-fares.controller'
import { AdminVehicleTypesController } from './admin-vehicle-types.controller'
import { AreasService } from './areas.service'
import { CatalogController } from './catalog.controller'
import { SuggestedFaresService } from './suggested-fares.service'
import { VehicleTypesService } from './vehicle-types.service'

@Module({
  imports: [AuditModule],
  controllers: [
    AdminAreasController,
    AdminVehicleTypesController,
    AdminSuggestedFaresController,
    CatalogController,
  ],
  providers: [AreasService, VehicleTypesService, SuggestedFaresService],
  exports: [AreasService, VehicleTypesService, SuggestedFaresService],
})
export class CatalogModule {}
