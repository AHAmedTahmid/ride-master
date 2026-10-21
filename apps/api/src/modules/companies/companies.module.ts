import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SettingsModule } from '../settings/settings.module'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'
import { CompanyDocumentsController } from './company-documents.controller'
import { CompanyDocumentsService } from './company-documents.service'

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [CompaniesController, CompanyDocumentsController],
  providers: [CompaniesService, CompanyDocumentsService],
  exports: [CompaniesService, CompanyDocumentsService],
})
export class CompaniesModule {}
