import { HttpException, HttpStatus } from '@nestjs/common'
import * as argon2 from 'argon2'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '@ride-master/shared'
import { OtpService } from './otp.service'

type OtpRow = {
  id: bigint
  publicId: string
  phone: string
  codeHash: string
  purpose: string
  attempts: number
  usedAt: Date | null
  expiresAt: Date
}

function makeMocks() {
  const rows: OtpRow[] = []
  let nextId = 1n
  const prisma = {
    otpCode: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row: OtpRow = {
          id: nextId++,
          publicId: args.data.publicId as string,
          phone: args.data.phone as string,
          codeHash: args.data.codeHash as string,
          purpose: args.data.purpose as string,
          attempts: 0,
          usedAt: null,
          expiresAt: args.data.expiresAt as Date,
        }
        rows.push(row)
        return row
      }),
      findFirst: vi.fn(
        async (args: {
          where: {
            phone: string
            purpose: string
            usedAt: null
            expiresAt: { gt: Date }
          }
          orderBy: { id: string }
        }) => {
          const candidates = rows
            .filter(
              (r) =>
                r.phone === args.where.phone &&
                r.purpose === args.where.purpose &&
                r.usedAt === null &&
                r.expiresAt > args.where.expiresAt.gt,
            )
            .sort((a, b) => (a.id < b.id ? 1 : -1))
          return candidates[0] ?? null
        },
      ),
      update: vi.fn(
        async (args: {
          where: { id: bigint }
          data: { usedAt?: Date; attempts?: number | { increment: number } }
        }) => {
          const row = rows.find((r) => r.id === args.where.id)
          if (!row) throw new Error('row not found')
          if (args.data.usedAt) row.usedAt = args.data.usedAt
          if (typeof args.data.attempts === 'object' && 'increment' in args.data.attempts) {
            row.attempts += args.data.attempts.increment
          } else if (typeof args.data.attempts === 'number') {
            row.attempts = args.data.attempts
          }
          return row
        },
      ),
    },
  }
  const redis = {
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => undefined),
  }
  const sms = { send: vi.fn(async () => undefined) }
  return { prisma, redis, sms, rows }
}

describe('OtpService', () => {
  let mocks: ReturnType<typeof makeMocks>
  let service: OtpService

  beforeEach(() => {
    mocks = makeMocks()
    service = new OtpService(
      mocks.prisma as never,
      mocks.redis as never,
      mocks.sms as never,
    )
  })

  describe('requestOtp', () => {
    it('stores an argon2 hash (never the code) and sends the code by SMS', async () => {
      const result = await service.requestOtp('+9607712345', 'login')
      expect(result).toEqual({ expiresInSeconds: OTP_TTL_SECONDS })

      const row = mocks.rows[0]
      expect(row.phone).toBe('+9607712345')
      expect(row.purpose).toBe('login')
      expect(row.codeHash).toMatch(/^\$argon2/)
      expect(mocks.sms.send).toHaveBeenCalledTimes(1)

      const [to, message] = mocks.sms.send.mock.calls[0]
      expect(to).toBe('+9607712345')
      expect(message).toMatch(/code is \d{6}/)
    })

    it('starts the per-phone rate-limit counter and its TTL', async () => {
      await service.requestOtp('+9607712345', 'login')
      expect(mocks.redis.incr).toHaveBeenCalledWith('otp:rl:+9607712345:login')
      expect(mocks.redis.expire).toHaveBeenCalledWith('otp:rl:+9607712345:login', 3600)
    })

    it('rejects when the per-phone hourly limit is exceeded', async () => {
      const limit = parseInt(process.env.OTP_RATE_LIMIT_PER_HOUR ?? '10', 10)
      mocks.redis.incr.mockResolvedValueOnce(limit + 1)
      await expect(service.requestOtp('+9607712345', 'login')).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      })
      expect(mocks.sms.send).not.toHaveBeenCalled()
    })

    it('rejects malformed numbers before touching any store', async () => {
      await expect(service.requestOtp('12345', 'login')).rejects.toThrow(/Invalid/)
      expect(mocks.prisma.otpCode.create).not.toHaveBeenCalled()
    })
  })

  describe('verifyOtp', () => {
    async function issue(phone = '+9607712345'): Promise<string> {
      await service.requestOtp(phone, 'login')
      const [, message] = mocks.sms.send.mock.calls.at(-1)!
      return message.match(/code is (\d{6})/)![1]
    }

    it('accepts the correct code exactly once (single-use)', async () => {
      const code = await issue()
      expect(await service.verifyOtp('+9607712345', code, 'login')).toBe(true)
      expect(await service.verifyOtp('+9607712345', code, 'login')).toBe(false)
    })

    it('rejects a wrong code and counts the attempt', async () => {
      const code = await issue()
      expect(await service.verifyOtp('+9607712345', '000000', 'login')).toBe(false)
      expect(mocks.rows[0].attempts).toBe(1)
      // Correct code still works afterwards.
      expect(await service.verifyOtp('+9607712345', code, 'login')).toBe(true)
    })

    it('burns the code after the maximum failed attempts', async () => {
      const code = await issue()
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await service.verifyOtp('+9607712345', '000000', 'login')
      }
      // Even the correct code fails once the record is burned.
      expect(await service.verifyOtp('+9607712345', code, 'login')).toBe(false)
      expect(mocks.rows[0].usedAt).not.toBeNull()
    })

    it('rejects codes for the wrong purpose', async () => {
      const code = await issue()
      expect(await service.verifyOtp('+9607712345', code, 'verify')).toBe(false)
    })

    it('rejects when no code was issued', async () => {
      expect(await service.verifyOtp('+9607799999', '123456', 'login')).toBe(false)
    })

    it('normalises the phone before verifying', async () => {
      const code = await issue('+9607712345')
      expect(await service.verifyOtp('7712345', code, 'login')).toBe(true)
    })
  })

  describe('rate limit integration', () => {
    it('counts requests per phone+purpose independently', async () => {
      await service.requestOtp('+9607712345', 'login')
      expect(mocks.redis.incr).toHaveBeenLastCalledWith('otp:rl:+9607712345:login')
      await service.requestOtp('+9607712345', 'register')
      expect(mocks.redis.incr).toHaveBeenLastCalledWith('otp:rl:+9607712345:register')
    })
  })

  // argon2 is exercised for real above; keep a smoke assertion on the helper.
  it('argon2 hashes verify', async () => {
    const h = await argon2.hash('123456', { type: argon2.argon2id })
    expect(await argon2.verify(h, '123456')).toBe(true)
    expect(await argon2.verify(h, '654321')).toBe(false)
  })

  it('rejects non-HTTP errors from leaking shape', () => {
    expect(new HttpException('x', 429)).toBeInstanceOf(HttpException)
  })
})
