import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    })
  }

  async onModuleInit() {
    // Log slow queries in development
    if (process.env.NODE_ENV !== 'production') {
      // @ts-expect-error Prisma event typing
      this.$on('query', (e: { query: string; duration: number }) => {
        if (e.duration > 200) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`)
        }
      })
    }

    await this.$connect()
    this.logger.log('Prisma connected to database')
  }

  async onModuleDestroy() {
    await this.$disconnect()
    this.logger.log('Prisma disconnected')
  }

  /**
   * Execute raw SQL — used by services that need queries Prisma cannot express
   * (e.g. spatial queries, generated columns).
   */
  async rawQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    return this.$queryRawUnsafe<T>(sql, ...params)
  }
}
