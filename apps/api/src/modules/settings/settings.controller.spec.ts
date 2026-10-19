import { describe, expect, it, vi } from 'vitest'
import { AdminSettingsController, SettingsController } from './settings.controller'

describe('SettingsController', () => {
  it('delegates getAll for any authenticated user', async () => {
    const service = { getAll: vi.fn(async () => ({ a: 1 })) }
    const controller = new SettingsController(service as never)
    expect(await controller.getAll({} as never)).toEqual({ a: 1 })
    expect(service.getAll).toHaveBeenCalled()
  })
})

describe('AdminSettingsController', () => {
  it('delegates updates with the actor id', async () => {
    const service = { update: vi.fn(async () => undefined) }
    const controller = new AdminSettingsController(service as never)
    const result = await controller.update({ userId: 7n } as never, {
      settingKey: 'search_radius_km',
      value: 12,
    })
    expect(result).toEqual({ settingKey: 'search_radius_km', value: 12 })
    expect(service.update).toHaveBeenCalledWith('search_radius_km', 12, 7n)
  })
})
