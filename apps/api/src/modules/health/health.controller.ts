import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/auth.decorators'
import { PrismaService } from '../../database/prisma.service'
import { RedisService } from '../../redis/redis.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

    const dbStart = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      checks.database = { ok: true, latencyMs: Date.now() - dbStart }
    } catch (err) {
      checks.database = { ok: false, error: (err as Error).message }
    }

    const redisStart = Date.now()
    const redisOk = await this.redis.ping()
    checks.redis = redisOk
      ? { ok: true, latencyMs: Date.now() - redisStart }
      : { ok: false, error: 'unreachable' }

    const allOk = Object.values(checks).every((c) => c.ok)
    return {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
      timestamp: new Date().toISOString(),
    }
  }
}
