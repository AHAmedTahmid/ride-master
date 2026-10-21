import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { DatabaseModule } from './database/database.module'
import { RedisModule } from './redis/redis.module'
import { PolicyModule } from './common/policy/policy.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { AuditModule } from './modules/audit/audit.module'
import { SettingsModule } from './modules/settings/settings.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { CompaniesModule } from './modules/companies/companies.module'
import { SmsModule } from './providers/sms/sms.module'
import { MapModule } from './providers/map/map.module'
import { StorageModule } from './providers/storage/storage.module'
import { HealthModule } from './modules/health/health.module'

@Module({
  imports: [
    // ── Config ─────────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),

    // ── Rate limiting ──────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: parseInt(process.env.RATE_LIMIT_TTL_MS ?? '60000', 10),
        limit: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
      },
    ]),

    // ── Scheduled jobs ─────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Infrastructure ─────────────────────────────────────────────────────────
    DatabaseModule,
    RedisModule,
    PolicyModule,

    // ── Providers ──────────────────────────────────────────────────────────────
    SmsModule,
    MapModule,
    StorageModule,

    // ── Feature modules ────────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    AuditModule,
    SettingsModule,
    NotificationsModule,
    CompaniesModule,
    HealthModule,
  ],
})
export class AppModule {}
