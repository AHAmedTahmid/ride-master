import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../../database/prisma.service'
import { AuthController } from './auth.controller'
import { AuthService, REFRESH_COOKIE } from './auth.service'

function makeRes() {
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  }
  return res
}

function makeReq(cookies: Record<string, string> = {}, ip = '127.0.0.1') {
  return { cookies, ip, headers: { 'user-agent': 'vitest' } } as never
}

function makeAuth(overrides: Partial<AuthService> = {}) {
  return {
    requestOtp: vi.fn(async () => ({ expiresInSeconds: 300 })),
    verifyOtp: vi.fn(async () => ({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { publicId: 'U1', activeRole: 'rider' },
    })),
    adminLogin: vi.fn(async () => ({ preAuthToken: 'pa' })),
    adminVerifyTotp: vi.fn(async () => ({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { publicId: 'U1', activeRole: 'superadmin' },
    })),
    refresh: vi.fn(async () => ({
      accessToken: 'at',
      refreshToken: 'rt2',
      user: { publicId: 'U1', activeRole: 'rider' },
    })),
    logout: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AuthService
}

describe('AuthController', () => {
  it('requestOtp delegates with the normalised body', async () => {
    const auth = makeAuth()
    const controller = new AuthController(auth)
    await controller.requestOtp({ phone: '+9607712345', purpose: 'login' })
    expect(auth.requestOtp).toHaveBeenCalledWith('+9607712345', 'login')
  })

  it('verifyOtp sets the refresh cookie and returns only the access token', async () => {
    const auth = makeAuth()
    const controller = new AuthController(auth)
    const res = makeRes()
    const body = await controller.verifyOtp(
      { phone: '+9607712345', code: '123456', purpose: 'register' },
      makeReq(),
      res as never,
    )
    expect(body).toEqual({ accessToken: 'at', user: { publicId: 'U1', activeRole: 'rider' } })
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      'rt',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', sameSite: 'lax' }),
    )
  })

  it('adminVerifyTotp sets the refresh cookie too', async () => {
    const controller = new AuthController(makeAuth())
    const res = makeRes()
    await controller.adminVerifyTotp(
      { email: 'a@b.mv', totpToken: '123456', preAuthToken: 'pa' },
      makeReq(),
      res as never,
    )
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'rt', expect.any(Object))
  })

  it('refresh reads the cookie and rotates it', async () => {
    const auth = makeAuth()
    const controller = new AuthController(auth)
    const res = makeRes()
    const body = await controller.refresh(makeReq({ [REFRESH_COOKIE]: 'rt' }), res as never)
    expect(auth.refresh).toHaveBeenCalledWith('rt')
    expect(body.accessToken).toBe('at')
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'rt2', expect.any(Object))
  })

  it('refresh without a cookie still calls the service (which rejects)', async () => {
    const auth = makeAuth({
      refresh: vi.fn(async () => {
        throw new ForbiddenException('nope')
      }),
    })
    const controller = new AuthController(auth)
    await expect(controller.refresh(makeReq({}), makeRes() as never)).rejects.toThrow()
    expect(auth.refresh).toHaveBeenCalledWith(undefined)
  })

  it('logout revokes the current session and clears the cookie', async () => {
    const auth = makeAuth()
    const controller = new AuthController(auth)
    const res = makeRes()
    const ctx = {
      sessionPublicId: 'S1',
      userPublicId: 'U1',
    }
    await controller.logout(ctx as never, makeReq(), res as never)
    expect(auth.logout).toHaveBeenCalledWith('S1', 'U1', '127.0.0.1')
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, { path: '/api/v1/auth' })
  })
})
