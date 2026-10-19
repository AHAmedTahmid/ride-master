import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetAndSeed } from '../../test/fixtures'
import { createTestApp } from '../../test/test-app'
import { API } from '../../test/login-helpers'

describe('Health (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    await resetAndSeed()
    app = (await createTestApp()).app
  })

  afterAll(async () => {
    await app.close()
  })

  it('is public and reports ok for database and redis', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/health`).expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.checks.database.ok).toBe(true)
    expect(res.body.checks.redis.ok).toBe(true)
    expect(typeof res.body.uptimeSeconds).toBe('number')
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date')
  })
})
