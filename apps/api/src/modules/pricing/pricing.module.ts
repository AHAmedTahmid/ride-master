import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { FaresController } from './fares.controller'
import { FaresService } from './fares.service'

@Module({
  imports: [AuditModule],
  controllers: [FaresController],
  providers: [FaresService],
  exports: [FaresService],
})
export class PricingModule {}
