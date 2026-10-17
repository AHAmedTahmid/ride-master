import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import compression from 'compression'
import { AppModule } from './app.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose'],
  })

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(helmet())
  app.use(compression())

  // ── Global prefix ───────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1')

  // ── CORS ────────────────────────────────────────────────────────────────────
  const origins = process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000']
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Idempotency-Key'],
  })

  // ── Validation ──────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // ── Swagger / OpenAPI ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ride Master API')
      .setDescription('Taxi marketplace API for the Maldives')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication and sessions')
      .addTag('companies', 'Company management')
      .addTag('drivers', 'Driver management')
      .addTag('vehicles', 'Vehicle management')
      .addTag('areas', 'Area and zone management')
      .addTag('fares', 'Fare and surcharge management')
      .addTag('bookings', 'Booking lifecycle')
      .addTag('admin', 'SuperAdmin operations')
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
