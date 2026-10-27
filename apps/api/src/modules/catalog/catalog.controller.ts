import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AreasService } from './areas.service'
import { SuggestedFaresService } from './suggested-fares.service'
import { VehicleTypesService } from './vehicle-types.service'

/**
 * Read-only catalog for any signed-in role: signup wizard picks service areas,
 * owners copy suggested fares, riders see vehicle types. No @Roles metadata —
 * JwtAuthGuard (global) still requires a valid session.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly areas: AreasService,
    private readonly vehicleTypes: VehicleTypesService,
    private readonly suggestedFares: SuggestedFaresService,
  ) {}

  @Get('areas')
  listAreas() {
    return this.areas.list({ activeOnly: true })
  }

  @Get('vehicle-types')
  listVehicleTypes() {
    return this.vehicleTypes.list()
  }

  @Get('suggested-fares')
  listSuggestedFares() {
    return this.suggestedFares.list()
  }
}
