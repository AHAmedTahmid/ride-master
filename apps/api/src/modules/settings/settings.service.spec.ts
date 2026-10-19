import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SettingsService, SETTING_DEFAULTS } from './settings.service'

function makeService(rows: Array<{ settingKey: string; value: unknown }> = []) {
  const prisma = {
    platformSetting: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async (args: { where: { settingKey: string } }) => {
        const row = rows.find((r) => r.settingKey === args.where.settingKey)
        return row ? { ...row, updatedBy: 1n } : null
      }),
      upsert: vi.fn(async () => undefined),
    },
  }
  const audit = { log: vi.fn(async () => undefined) }
  const service = new SettingsService(prisma as never, audit as never)
  return { service, prisma, audit }
}

describe('SettingsService', () => {
  it('returns compiled defaults when the table is empty', async () => {
    const { service } = makeService()
    const all = await service.getAll()
    expect(all).toEqual(SETTING_DEFAULTS)
    expect(all.default_commission_bps).toBe(1000)
    expect(all.gst_rate_bps).toBe(0)
  })

  it('overrides defaults with rows from the table', async () => {
    const { service } = makeService([
      { settingKey: 'search_radius_km', value: 25 },
      { settingKey: 'gst_rate_bps', value: 800 },
    ])
    const all = await service.getAll()
    expect(all.search_radius_km).toBe(25)
    expect(all.gst_rate_bps).toBe(800)
    expect(all.request_timeout_seconds).toBe(60)
  })

  it('getNumber coerces numeric strings and rejects non-numbers', async () => {
    const { service } = makeService([{ settingKey: 'search_radius_km', value: '18' }])
    expect(await service.getNumber('search_radius_km')).toBe(18)
    expect(await service.getNumber('request_timeout_seconds')).toBe(60)

    const bad = makeService([{ settingKey: 'search_radius_km', value: 'wide' }])
    await expect(bad.service.getNumber('search_radius_km')).rejects.toThrow(BadRequestException)
  })

  it('update rejects unknown keys', async () => {
    const { service, prisma } = makeService()
    await expect(service.update('not_a_setting', 1, 1n)).rejects.toThrow(/Unknown setting/)
    expect(prisma.platformSetting.upsert).not.toHaveBeenCalled()
  })

  it('update upserts and audits old/new values', async () => {
    const { service, prisma, audit } = makeService([
      { settingKey: 'search_radius_km', value: 10 },
    ])
    await service.update('search_radius_km', 12, 7n)
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settingKey: 'search_radius_km' },
        update: { value: 12, updatedBy: 7n },
      }),
    )
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_SETTING_CHANGED',
        oldValue: { value: 10 },
        newValue: { value: 12 },
      }),
    )
  })

  it('update audits a missing before-value as undefined', async () => {
    const { service, audit } = makeService()
    await service.update('gst_rate_bps', 500, 7n)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PLATFORM_SETTING_CHANGED' }),
    )
  })
})
