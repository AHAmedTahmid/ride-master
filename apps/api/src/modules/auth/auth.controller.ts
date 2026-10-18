import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Request, Response } from 'express'
import {
  AdminLoginSchema,
  RequestOtpSchema,
  VerifyOtpSchema,
  VerifyTotpSchema,
} from '@ride-master/shared'
import { CurrentUser, AuthContext, Public } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { AuthService, REFRESH_COOKIE } from './auth.service'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Request an OTP for phone login/registration. Strict per-phone limit. */
  @Public()
  @Post('otp/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestOtp(@Body(new ZodValidationPipe(RequestOtpSchema)) body: { phone: string; purpose: 'login' | 'register' | 'verify' }) {
    return this.auth.requestOtp(body.phone, body.purpose)
  }

  /** Verify the OTP; creates a rider account on 'register'. Sets refresh cookie. */
  @Public()
  @Post('otp/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(VerifyOtpSchema))
    body: { phone: string; code: string; purpose: 'login' | 'register' | 'verify' },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp({
      phone: body.phone,
      code: body.code,
      purpose: body.purpose,
      ip: req.ip,
      deviceInfo: this.deviceInfo(req),
    })
    this.setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  /** Superadmin step 1: password → preAuthToken. */
  @Public()
  @Post('admin/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  adminLogin(
    @Body(new ZodValidationPipe(AdminLoginSchema)) body: { email: string; password: string },
    @Req() req: Request,
  ) {
    return this.auth.adminLogin(body.email, body.password, req.ip)
  }

  /** Superadmin step 2: preAuthToken + TOTP → token pair. */
  @Public()
  @Post('admin/login/totp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async adminVerifyTotp(
    @Body(new ZodValidationPipe(VerifyTotpSchema))
    body: { email: string; totpToken: string; preAuthToken: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.adminVerifyTotp({
      email: body.email,
      totpToken: body.totpToken,
      preAuthToken: body.preAuthToken,
      ip: req.ip,
      deviceInfo: this.deviceInfo(req),
    })
    this.setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  /** Rotate the refresh token (httpOnly cookie) into a new access token. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined
    const result = await this.auth.refresh(token)
    this.setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(204)
  async logout(
    @CurrentUser() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth.sessionPublicId, auth.userPublicId, req.ip)
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
  }

  private setRefreshCookie(res: Response, token: string): void {
    const days = parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '7', 10)
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: days * 24 * 60 * 60 * 1000,
    })
  }

  private deviceInfo(req: Request): Record<string, unknown> {
    return {
      userAgent: req.headers['user-agent'] ?? null,
      acceptLanguage: req.headers['accept-language'] ?? null,
    }
  }
}
