import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { FaresController } from './fares.controller'
import { FaresService } from './fares.service'
import { SurchargesController } from './surcharges.controller'
import { SurchargesService } from './surcharges.service'

@Module({
  imports: [AuditModule],
  controllers: [FaresController, SurchargesController],
  providers: [FaresService, SurchargesService],
  exports: [FaresService, SurchargesService],
})
export class PricingModule {}
