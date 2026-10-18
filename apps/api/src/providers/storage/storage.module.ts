import { Global, Module } from '@nestjs/common'
import { S3StorageProvider } from './s3-storage.provider'
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider'

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (): StorageProvider => {
        const kind = process.env.STORAGE_PROVIDER ?? 'minio'
        switch (kind) {
          case 'minio':
          case 's3':
            return new S3StorageProvider()
          default:
            throw new Error(`Unknown STORAGE_PROVIDER '${kind}'`)
        }
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
