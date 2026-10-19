/**
 * Boots the full AppModule in-process for e2e specs (supertest against the
 * HTTP server, real MySQL + Redis). The SMS provider is replaced with a
 * recorder so specs can read OTP codes without parsing logs.
 */
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { AppModule } from '../app.module'
import { SMS_PROVIDER, SmsProvider } from '../providers/sms/sms.provider'
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter'
import { RequestIdInterceptor } from '../common/interceptors/request-id.interceptor'

export class TestSmsProvider implements SmsProvider {
  readonly sent: Array<{ to: string; message: string }> = []

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message })
  }

  /** Extract the 6-digit code from the most recent SMS to this phone. */
  lastCodeFor(phone: string): string {
    const entry = [...this.sent].reverse().find((s) => s.to === phone)
    if (!entry) throw new Error(`No SMS was sent to ${phone}`)
    const match = entry.message.match(/code is (\d{6})/)
    if (!match) throw new Error(`No 6-digit code in SMS: ${entry.message}`)
    return match[1]
  }
}

export interface TestApp {
  app: INestApplication
  sms: TestSmsProvider
}

export async function createTestApp(): Promise<TestApp> {
  const sms = new TestSmsProvider()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile()

  const app = moduleRef.createNestApplication()
  app.use(cookieParser())
  app.setGlobalPrefix('api/v1')
  app.useGlobalInterceptors(new RequestIdInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.init()
  return { app, sms }
}
