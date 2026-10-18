import { Global, Module } from '@nestjs/common'
import { ConsoleSmsProvider } from './console-sms.provider'
import { SMS_PROVIDER, SmsProvider } from './sms.provider'

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: (): SmsProvider => {
        const kind = process.env.SMS_PROVIDER ?? 'console'
        switch (kind) {
          case 'console':
            return new ConsoleSmsProvider()
          default:
            throw new Error(`Unknown SMS_PROVIDER '${kind}'`)
        }
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
