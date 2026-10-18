import { BadRequestException, Injectable } from '@nestjs/common'
import { SETTINGS_KEYS } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { AuditService } from '../audit/audit.service'

const KNOWN_KEYS = new Set<string>(Object.values(SETTINGS_KEYS))

/** Compiled defaults for any setting row missing from the table. */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  default_commission_bps: 1000,
  request_timeout_seconds: 60,
  search_radius_km: 10,
  cancellation_window_seconds: 300,
  cancellation_fee_laari: 0,
  individual_vehicle_limit: 3,
  new_company_starting_credit_laari: 50000,
  min_online_drivers: 1,
  gst_rate_bps: 0,
  daily_sms_budget: 1000,
  booking_locations_retention_days: 90,
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All settings with compiled defaults for any missing row. */
  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.platformSetting.findMany()
    const result: Record<string, unknown> = { ...SETTING_DEFAULTS }
    for (const row of rows) {
      result[row.settingKey] = row.value
    }
    return result
  }

  async getNumber(key: string): Promise<number> {
    const all = await this.getAll()
    const value = all[key]
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(n)) {
      throw new BadRequestException(`Setting '${key}' is not numeric`)
    }
    return n
  }

  async update(key: string, value: unknown, actorUserId: bigint): Promise<void> {
    if (!KNOWN_KEYS.has(key)) {
      throw new BadRequestException(`Unknown setting '${key}'`)
    }
    const before = await this.prisma.platformSetting.findUnique({ where: { settingKey: key } })
    const jsonValue = value as never
    await this.prisma.platformSetting.upsert({
      where: { settingKey: key },
      create: { settingKey: key, value: jsonValue, updatedBy: actorUserId },
      update: { value: jsonValue, updatedBy: actorUserId },
    })
    await this.audit.log({
      actorUserId,
      action: 'PLATFORM_SETTING_CHANGED',
      entityType: 'platform_setting',
      entityId: key,
      oldValue: before ? { value: before.value as unknown } : undefined,
      newValue: { value },
    })
  }
}
