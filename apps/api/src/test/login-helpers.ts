/**
 * HTTP login helpers for e2e specs. Codes come from the TestSmsProvider
 * recorder; TOTP codes are generated against the shared fixture secret.
 */
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { TestSmsProvider } from './test-app'
import { currentTotpCode, TEST_ADMIN_PASSWORD } from './fixtures'

const API = '/api/v1'

export interface OtpLoginResult {
  accessToken: string
  user: { publicId: string; activeRole: string; roles: string[] }
  refreshCookie?: string
}

export async function otpRequestAndVerify(
  app: INestApplication,
  sms: TestSmsProvider,
  phone: string,
  purpose: 'login' | 'register',
): Promise<OtpLoginResult> {
  const http = request(app.getHttpServer())
  const requestRes = await http
    .post(`${API}/auth/otp/request`)
    .send({ phone, purpose })
    .expect(201)
  void requestRes

  const code = sms.lastCodeFor(phone)
  const res = await http
    .post(`${API}/auth/otp/verify`)
    .send({ phone, code, purpose })
    .expect(200)

  return {
    accessToken: res.body.accessToken,
    user: res.body.user,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
  }
}

export interface AdminLoginResult {
  accessToken: string
  user: { publicId: string; activeRole: string; adminLevel?: string }
  refreshCookie?: string
}

export async function adminPasswordAndTotpLogin(
  app: INestApplication,
  email: string,
): Promise<AdminLoginResult> {
  const http = request(app.getHttpServer())
  const pre = await http
    .post(`${API}/auth/admin/login`)
    .send({ email, password: TEST_ADMIN_PASSWORD })
    .expect(200)

  const totpToken = await currentTotpCode()
  const res = await http
    .post(`${API}/auth/admin/login/totp`)
    .send({ email, totpToken, preAuthToken: pre.body.preAuthToken })
    .expect(200)

  return {
    accessToken: res.body.accessToken,
    user: res.body.user,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
  }
}

export function extractRefreshCookie(
  setCookie: string | string[] | undefined,
): string | undefined {
  if (!setCookie) return undefined
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const refresh = cookies.find((c) => c.startsWith('rm_refresh='))
  return refresh ? refresh.split(';')[0] : undefined
}

export { API }
