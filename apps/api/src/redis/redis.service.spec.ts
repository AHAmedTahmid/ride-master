import { describe, expect, it, vi } from 'vitest'
import { RedisService } from './redis.service'

function makeFakeClient(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(async () => 'v'),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 3),
    expire: vi.fn(async () => 1),
    hset: vi.fn(async () => 1),
    hget: vi.fn(async () => 'f'),
    hgetall: vi.fn(async () => ({ a: '1' })),
    hdel: vi.fn(async () => 1),
    geoadd: vi.fn(async () => 1),
    georadius: vi.fn(async () => ['driver:1']),
    zrem: vi.fn(async () => 1),
    geopos: vi.fn(async () => [['73.5', '4.1']]),
    publish: vi.fn(async () => 1),
    ping: vi.fn(async () => 'PONG'),
    ...overrides,
  }
}

describe('RedisService', () => {
  it('get/set round-trip with and without TTL', async () => {
    const client = makeFakeClient()
    const svc = new RedisService(client as never)
    expect(await svc.get('k')).toBe('v')
    await svc.set('k', 'v2')
    expect(client.set).toHaveBeenCalledWith('k', 'v2')
    await svc.set('k', 'v3', 60)
    expect(client.set).toHaveBeenCalledWith('k', 'v3', 'EX', 60)
  })

  it('del/incr/expire delegate to the client', async () => {
    const client = makeFakeClient()
    const svc = new RedisService(client as never)
    await svc.del('k')
    expect(client.del).toHaveBeenCalledWith('k')
    expect(await svc.incr('counter')).toBe(3)
    await svc.expire('counter', 3600)
    expect(client.expire).toHaveBeenCalledWith('counter', 3600)
  })

  it('hash helpers delegate to the client', async () => {
    const client = makeFakeClient()
    const svc = new RedisService(client as never)
    await svc.hset('h', 'f', '1')
    expect(await svc.hget('h', 'f')).toBe('f')
    expect(await svc.hgetall('h')).toEqual({ a: '1' })
    await svc.hdel('h', 'f')
    expect(client.hdel).toHaveBeenCalledWith('h', 'f')
  })

  it('georadius returns members; WithDist maps [member, dist] pairs', async () => {
    const client = makeFakeClient({
      georadius: vi
        .fn()
        .mockResolvedValueOnce(['driver:1'])
        .mockResolvedValueOnce([['driver:1', '1.5']]),
    })
    const svc = new RedisService(client as never)
    expect(await svc.geoadd('drivers', 73.5, 4.1, 'driver:1').then(() => svc.georadius('drivers', 73.5, 4.1, 10))).toEqual([
      'driver:1',
    ])
    expect(await svc.georadiusWithDist('drivers', 73.5, 4.1, 10)).toEqual([
      { member: 'driver:1', distance: 1.5 },
    ])
  })

  it('georem and geopos parse coordinates', async () => {
    const client = makeFakeClient()
    const svc = new RedisService(client as never)
    await svc.georem('drivers', 'driver:1')
    expect(await svc.geopos('drivers', 'driver:1')).toEqual({ lng: 73.5, lat: 4.1 })
  })

  it('geopos returns null when the member is missing', async () => {
    const client = makeFakeClient({ geopos: vi.fn(async () => null) })
    const svc = new RedisService(client as never)
    expect(await svc.geopos('drivers', 'ghost')).toBeNull()
  })

  it('publish delegates', async () => {
    const client = makeFakeClient()
    const svc = new RedisService(client as never)
    await svc.publish('channel', 'msg')
    expect(client.publish).toHaveBeenCalledWith('channel', 'msg')
  })

  it('ping reports reachable and unreachable', async () => {
    expect(await new RedisService(makeFakeClient() as never).ping()).toBe(true)
    expect(
      await new RedisService(makeFakeClient({ ping: vi.fn(async () => 'NOPE') }) as never).ping(),
    ).toBe(false)
    expect(
      await new RedisService(
        makeFakeClient({ ping: vi.fn(async () => Promise.reject(new Error('down'))) }) as never,
      ).ping(),
    ).toBe(false)
  })
})
