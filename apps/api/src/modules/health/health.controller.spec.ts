import { describe, expect, it, vi } from 'vitest'
import { HealthController } from './health.controller'

function makeController(opts: { dbFails?: boolean; redisOk?: boolean } = {}) {
  const prisma = {
    $queryRaw: vi.fn(async () => {
      if (opts.dbFails) throw new Error('db down')
      return [{ 1: 1 }]
    }),
  }
  const redis = { ping: vi.fn(async () => opts.redisOk ?? true) }
  return new HealthController(prisma as never, redis as never)
}

describe('HealthController', () => {
  it('reports ok when both dependencies respond', async () => {
    const result = await makeController().check()
    expect(result.status).toBe('ok')
    expect(result.checks.database.ok).toBe(true)
    expect(result.checks.redis.ok).toBe(true)
  })

  it('reports degraded when the database is down', async () => {
    const result = await makeController({ dbFails: true }).check()
    expect(result.status).toBe('degraded')
    expect(result.checks.database.ok).toBe(false)
    expect(result.checks.database.error).toBe('db down')
  })

  it('reports degraded when redis is unreachable', async () => {
    const result = await makeController({ redisOk: false }).check()
    expect(result.status).toBe('degraded')
    expect(result.checks.redis).toEqual({ ok: false, error: 'unreachable' })
  })
})
