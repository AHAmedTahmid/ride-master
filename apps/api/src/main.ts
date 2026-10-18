import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose'],
  })

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(helmet())
  app.use(compression())
  app.use(cookieParser())

  // ── Global prefix ───────────────────────────────────────────────────────────
  // The URL carries the API version (/api/v1); Nest URI versioning would
  // duplicate it, so routes are versioned by prefix alone.
  app.setGlobalPrefix('api/v1')

  // ── CORS ────────────────────────────────────────────────────────────────────
  const origins = process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000']
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Idempotency-Key'],
  })

  // ── Cross-cutting: request ids + one error envelope ─────────────────────────
  app.useGlobalInterceptors(new RequestIdInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())

  // ── Swagger / OpenAPI ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ride Master API')
      .setDescription('Taxi marketplace API for the Maldives')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('rm_refresh')
      .addTag('auth', 'Authentication and sessions')
      .addTag('me', 'Current user profile and role switching')
      .addTag('settings', 'Platform tunables')
      .addTag('admin', 'SuperAdmin operations')
      .addTag('health', 'Liveness and readiness')
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
    logger.log('Swagger docs available at /api/docs')
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  app.enableShutdownHooks()

  // ── Start ───────────────────────────────────────────────────────────────────
  const port = process.env.APP_PORT ?? 3001
  await app.listen(port)
  logger.log(`Ride Master API running on port ${port}`)
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`)
}

bootstrap()
