import { Logger } from '@nestjs/common'
import { SmsProvider } from './sms.provider'

/**
 * Development SMS provider: prints the message to the API log.
 * Refuses to construct in production — a real provider must be configured.
 */
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name)

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleSmsProvider must not be used in production')
    }
  }

  async send(to: string, message: string): Promise<void> {
    this.logger.log(`[SMS → ${to}] ${message}`)
  }
}
