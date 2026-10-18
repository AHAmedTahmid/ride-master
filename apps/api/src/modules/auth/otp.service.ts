import { HttpException, Inject, Injectable, HttpStatus } from '@nestjs/common'
import * as argon2 from 'argon2'
import { randomInt } from 'crypto'
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '@ride-master/shared'
import { PrismaService } from '../../database/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { generateUlid } from '../../common/utils/ulid'
import { normalizePhone } from '../../common/utils/phone'
import { SMS_PROVIDER, SmsProvider } from '../../providers/sms/sms.provider'

export type OtpPurpose = 'login' | 'register' | 'verify'

/**
 * Phone OTP flow: request → SMS → verify.
 * Codes are argon2-hashed at rest, single-use, 5 attempts, 5-minute TTL.
 * Two rate limits: per-phone per-hour (Redis counter) and per-route (throttler).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async requestOtp(rawPhone: string, purpose: OtpPurpose): Promise<{ expiresInSeconds: number }> {
    const phone = normalizePhone(rawPhone)

    const limit = parseInt(process.env.OTP_RATE_LIMIT_PER_HOUR ?? '10', 10)
    const counterKey = `otp:rl:${phone}:${purpose}`
    const count = await this.redis.incr(counterKey)
    if (count === 1) {
      await this.redis.expire(counterKey, 3600)
    }
    if (count > limit) {
      throw new HttpException('Too many code requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS)
    }

    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0')
    const codeHash = await argon2.hash(code, { type: argon2.argon2id })

    await this.prisma.otpCode.create({
      data: {
        publicId: generateUlid(),
        phone,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    })

    await this.sms.send(phone, `Your Ride Master code is ${code}. Valid for 5 minutes.`)
    return { expiresInSeconds: OTP_TTL_SECONDS }
  }

  /**
   * Verifies the newest unexpired, unused code for the phone+purpose.
   * Returns true on success. Failed attempts are counted; the code is
   * burned once attempts reach the maximum.
   */
  async verifyOtp(rawPhone: string, code: string, purpose: OtpPurpose): Promise<boolean> {
    const phone = normalizePhone(rawPhone)

    const record = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { id: 'desc' },
    })
    if (!record) return false

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      })
      return false
    }

    const valid = await argon2.verify(record.codeHash, code)
    if (!valid) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      })
      return false
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { usedAt: new Date(), attempts: { increment: 1 } },
    })
    return true
  }
}
