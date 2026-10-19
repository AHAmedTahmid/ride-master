import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetAndSeed, FIXTURES, TEST_ADMIN_PASSWORD, currentTotpCode } from '../../test/fixtures'
import { createTestApp, TestSmsProvider } from '../../test/test-app'
import {
  adminPasswordAndTotpLogin,
  otpRequestAndVerify,
  API,
} from '../../test/login-helpers'

describe('Auth flows (e2e)', () => {
  let app: INestApplication
  let sms: TestSmsProvider

  beforeAll(async () => {
    await resetAndSeed()
    const created = await createTestApp()
    app = created.app
    sms = created.sms
  })

  afterAll(async () => {
    await app.close()
  })

  describe('POST /auth/otp/request + /auth/otp/verify', () => {
    it('registers a brand-new rider and returns an access token', async () => {
      const phone = '+9607711111'
      const result = await otpRequestAndVerify(app, sms, phone, 'register')
      expect(result.accessToken).toBeTruthy()
      expect(result.user.activeRole).toBe('rider')
      expect(result.refreshCookie).toMatch(/^rm_refresh=/)
    })

    it('rejects a wrong code with the standard envelope', async () => {
      const phone = '+9607722222'
      await request(app.getHttpServer())
        .post(`${API}/auth/otp/request`)
        .send({ phone, purpose: 'register' })
        .expect(201)

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/otp/verify`)
        .send({ phone, code: '000000', purpose: 'register' })
        .expect(401)
      expect(res.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired code',
      })
    })

    it('rejects malformed phones with field-level validation errors', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/auth/otp/request`)
        .send({ phone: '123', purpose: 'login' })
        .expect(400)
      expect(res.body.message).toBe('Validation failed')
      expect(res.body.fields?.[0]?.field).toBe('phone')
    })

    it('refuses login for a number that never registered', async () => {
      const phone = '+9607733333'
      await request(app.getHttpServer())
        .post(`${API}/auth/otp/request`)
        .send({ phone, purpose: 'login' })
        .expect(201)

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/otp/verify`)
        .send({ phone, code: sms.lastCodeFor(phone), purpose: 'login' })
        .expect(401)
      expect(res.body.message).toMatch(/Register first/)
    })

    it('logs in a seeded account by phone', async () => {
      const result = await otpRequestAndVerify(
        app,
        sms,
        FIXTURES.driver.phone,
        'login',
      )
      expect(result.user.activeRole).toBe('driver')
    })
  })

  describe('POST /auth/admin/login + /totp', () => {
    it('completes the two-step password+TOTP login', async () => {
      const result = await adminPasswordAndTotpLogin(
        app,
        FIXTURES.superadmins.super,
      )
      expect(result.accessToken).toBeTruthy()
      expect(result.user.activeRole).toBe('superadmin')
      expect(result.user.adminLevel).toBe('super')
    })

    it('rejects a wrong password without revealing the account', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/auth/admin/login`)
        .send({ email: FIXTURES.superadmins.super, password: 'wrongpassword' })
        .expect(401)
      expect(res.body.message).toBe('Invalid email or password')
    })

    it('rejects an invalid TOTP code', async () => {
      const pre = await request(app.getHttpServer())
        .post(`${API}/auth/admin/login`)
        .send({ email: FIXTURES.superadmins.super, password: TEST_ADMIN_PASSWORD })
        .expect(200)

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/admin/login/totp`)
        .send({
          email: FIXTURES.superadmins.super,
          totpToken: '000000',
          preAuthToken: pre.body.preAuthToken,
        })
        .expect(401)
      expect(res.body.message).toBe('Invalid authentication code')
    })

    it('rejects a pre-auth token used for a different email', async () => {
      const pre = await request(app.getHttpServer())
        .post(`${API}/auth/admin/login`)
        .send({
          email: FIXTURES.superadmins.super,
          password: TEST_ADMIN_PASSWORD,
        })
        .expect(200)

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/admin/login/totp`)
        .send({
          email: FIXTURES.superadmins.verifier,
          totpToken: await currentTotpCode(),
          preAuthToken: pre.body.preAuthToken,
        })
        .expect(401)
      expect(res.body.message).toMatch(/does not match/)
    })
  })

  describe('POST /auth/refresh', () => {
    it('rotates the refresh cookie and rejects the old one', async () => {
      const login = await otpRequestAndVerify(app, sms, '+9607744444', 'register')
      const http = request(app.getHttpServer())

      const first = await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', login.refreshCookie!)
        .expect(200)
      expect(first.body.accessToken).toBeTruthy()
      const secondCookie = (
        Array.isArray(first.headers['set-cookie']) ? first.headers['set-cookie'] : [first.headers['set-cookie']]
      ).find((c: string) => c.startsWith('rm_refresh='))!
      expect(secondCookie).not.toBe(login.refreshCookie)

      // The old cookie is dead (rotation), the new one works.
      await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', login.refreshCookie!)
        .expect(401)
      await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', secondCookie.split(';')[0])
        .expect(200)
    })

    it('rejects requests with no refresh cookie', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/auth/refresh`)
        .expect(401)
      expect(res.body.message).toBe('Missing refresh token')
    })
  })

  describe('POST /auth/logout', () => {
    it('revokes the session and kills the refresh token', async () => {
      const login = await otpRequestAndVerify(app, sms, '+9607755555', 'register')
      const http = request(app.getHttpServer())

      await http
        .post(`${API}/auth/logout`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(204)

      await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', login.refreshCookie!)
        .expect(401)

      // Access token dies too — the guard reloads the session per request.
      await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(401)
    })

    it('requires authentication (negative case)', async () => {
      await request(app.getHttpServer()).post(`${API}/auth/logout`).expect(401)
    })
  })

  describe('POST /me/switch-role + PATCH /me/language', () => {
    it('switching to a role the rider does not hold is rejected (negative case)', async () => {
      const login = await otpRequestAndVerify(app, sms, '+9607766666', 'register')
      const res = await request(app.getHttpServer())
        .post(`${API}/me/switch-role`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .send({ role: 'superadmin' })
        .expect(403)
      expect(res.body.message).toMatch(/not active/)
    })

    it('persists and returns the language preference', async () => {
      const login = await otpRequestAndVerify(app, sms, '+9607777777', 'register')
      const http = request(app.getHttpServer())
      await http
        .patch(`${API}/me/language`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .send({ language: 'dv' })
        .expect(200)
      const me = await http
        .get(`${API}/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(200)
      expect(me.body.language).toBe('dv')
    })
  })
})
