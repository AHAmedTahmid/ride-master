import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SettingsModule } from '../settings/settings.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'
import { CompanyDocumentsController } from './company-documents.controller'
import { CompanyDocumentsService } from './company-documents.service'
import { AdminCompaniesController } from './admin-companies.controller'
import { AdminCompaniesService } from './admin-companies.service'

@Module({
  imports: [AuthModule, SettingsModule, NotificationsModule],
  controllers: [CompaniesController, CompanyDocumentsController, AdminCompaniesController],
  providers: [CompaniesService, CompanyDocumentsService, AdminCompaniesService],
  exports: [CompaniesService, CompanyDocumentsService, AdminCompaniesService],
})
export class CompaniesModule {}
