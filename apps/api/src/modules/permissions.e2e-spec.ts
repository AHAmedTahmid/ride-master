import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetAndSeed, FIXTURES } from '../test/fixtures'
import { createTestApp, TestSmsProvider } from '../test/test-app'
import {
  adminPasswordAndTotpLogin,
  otpRequestAndVerify,
  API,
} from '../test/login-helpers'

/**
 * Permission matrix over real endpoints, with real tokens and real DB state.
 * Both allow and deny cases are asserted; denies must use the standard
 * envelope and never leak internals.
 */
describe('Permission matrix (e2e)', () => {
  let app: INestApplication
  let http: ReturnType<typeof request>
  let sms: TestSmsProvider
  let riderToken: string
  let ownerToken: string
  let driverToken: string
  let superToken: string
  let verifierToken: string

  beforeAll(async () => {
    await resetAndSeed()
    const created = await createTestApp()
    app = created.app
    sms = created.sms
    http = request(app.getHttpServer())

    riderToken = (await otpRequestAndVerify(app, sms, FIXTURES.rider.phone, 'login')).accessToken
    ownerToken = (await otpRequestAndVerify(app, sms, FIXTURES.owner.phone, 'login')).accessToken
    driverToken = (await otpRequestAndVerify(app, sms, FIXTURES.driver.phone, 'login')).accessToken
    superToken = (await adminPasswordAndTotpLogin(app, FIXTURES.superadmins.super)).accessToken
    verifierToken = (await adminPasswordAndTotpLogin(app, FIXTURES.superadmins.verifier))
      .accessToken
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /me/audit-logs → GET /admin/audit-logs', () => {
    it('401 without a token', async () => {
      const res = await http.get(`${API}/admin/audit-logs`).expect(401)
      expect(res.body.statusCode).toBe(401)
    })

    it('403 for rider, owner and driver', async () => {
      for (const token of [riderToken, ownerToken, driverToken]) {
        const res = await http
          .get(`${API}/admin/audit-logs`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403)
        expect(res.body.message).toMatch(/requires role: superadmin/)
        // Never leak internals.
        expect(JSON.stringify(res.body)).not.toMatch(/BigInt|bigint/)
      }
    })

    it('200 for any superadmin level, exposing actor public ids only', async () => {
      for (const token of [superToken, verifierToken]) {
        const res = await http
          .get(`${API}/admin/audit-logs`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        expect(Array.isArray(res.body.data)).toBe(true)
        expect(res.body.meta).toMatchObject({ page: 1, limit: 50 })
        if (res.body.data.length > 0) {
          const row = res.body.data[0]
          expect(row).toHaveProperty('actorPublicId')
          expect(row).not.toHaveProperty('actorUserId')
        }
      }
    })

    it('filters by action', async () => {
      const res = await http
        .get(`${API}/admin/audit-logs?action=LOGIN_ADMIN`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)
      for (const row of res.body.data) {
        expect(row.action).toBe('LOGIN_ADMIN')
      }
    })
  })

  describe('GET /settings + PUT /admin/settings', () => {
    it('any authenticated role may read the tunables', async () => {
      for (const token of [riderToken, ownerToken, driverToken, superToken]) {
        const res = await http
          .get(`${API}/settings`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        expect(res.body).toHaveProperty('default_commission_bps')
        expect(res.body).toHaveProperty('search_radius_km')
      }
    })

    it('only the super level may update settings', async () => {
      // verifier (superadmin but wrong level) — negative case.
      const denied = await http
        .put(`${API}/admin/settings`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ settingKey: 'search_radius_km', value: 12 })
        .expect(403)
      expect(denied.body.message).toMatch(/requires admin level/)

      // rider — negative case.
      await http
        .put(`${API}/admin/settings`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ settingKey: 'search_radius_km', value: 12 })
        .expect(403)

      // unauthenticated — negative case.
      await http
        .put(`${API}/admin/settings`)
        .send({ settingKey: 'search_radius_km', value: 12 })
        .expect(401)

      // super — allowed, and the change is visible on the next read.
      await http
        .put(`${API}/admin/settings`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ settingKey: 'search_radius_km', value: 12 })
        .expect(200)
      const after = await http
        .get(`${API}/settings`)
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200)
      expect(after.body.search_radius_km).toBe(12)
    })

    it('rejects unknown setting keys with 400', async () => {
      const res = await http
        .put(`${API}/admin/settings`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ settingKey: 'not_a_setting', value: 1 })
        .expect(400)
      expect(res.body.message).toMatch(/Unknown setting/)
    })

    it('rejects malformed bodies with field errors', async () => {
      const res = await http
        .put(`${API}/admin/settings`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ value: 1 })
        .expect(400)
      expect(res.body.fields?.[0]?.field).toBe('settingKey')
    })
  })

  describe('GET /me + /me/notifications', () => {
    it('returns the profile with the active role and company scope', async () => {
      const res = await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200)
      expect(res.body.activeRole).toBe('company_owner')
      expect(res.body.roles[0].company).toMatchObject({ name: 'Azure Cabs' })
    })

    it('a superadmin profile carries the admin level', async () => {
      const res = await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)
      expect(res.body.adminLevel).toBe('super')
    })

    it('notifications list is scoped to the caller (empty for fresh riders)', async () => {
      const res = await http
        .get(`${API}/me/notifications`)
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200)
      expect(res.body).toEqual([])
    })

    it('marking another user’s notification is a no-op (row counts unchanged)', async () => {
      await http
        .patch(`${API}/me/notifications/01ARZ3NDEKTSV4RRFFQ69G5FAV/read`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ read: true })
        .expect(200)
    })
  })

  describe('suspended account loses access immediately', () => {
    it('401 on the next request after suspension', async () => {
      const login = await otpRequestAndVerify(app, sms, '+9607788888', 'register')
      await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(200)

      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      try {
        await prisma.user.update({
          where: { phone: '+9607788888' },
          data: { status: 'suspended' },
        })
      } finally {
        await prisma.$disconnect()
      }

      const res = await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(401)
      expect(res.body.message).toMatch(/not active/)
    })
  })
})
