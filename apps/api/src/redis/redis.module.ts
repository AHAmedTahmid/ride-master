import { Module, Global } from '@nestjs/common'
import { RedisService } from './redis.service'
import Redis from 'ioredis'

const REDIS_CLIENT = 'REDIS_CLIENT'

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
        const client = new Redis(url, {
          maxRetriesPerRequest: 3,
          retryStrategy(times: number) {
            const delay = Math.min(times * 200, 5000)
            return delay
          },
          lazyConnect: false,
        })
        client.on('error', (err) => {
          console.error('[Redis] Connection error:', err.message)
        })
        client.on('connect', () => {
          console.info('[Redis] Connected')
        })
        return client
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}

export { REDIS_CLIENT }
