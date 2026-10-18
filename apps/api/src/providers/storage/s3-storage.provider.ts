import { Logger } from '@nestjs/common'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { StorageProvider } from './storage.provider'

/**
 * S3-compatible storage. Works against MinIO in dev and any S3 API in
 * production. Documents and photos are private; access is via expiring
 * signed URLs only.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name)
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    const endpoint = process.env.STORAGE_ENDPOINT
    this.bucket = process.env.STORAGE_BUCKET ?? 'ride-master'
    this.client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
      },
    })
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    )
    this.logger.debug(`Stored s3://${this.bucket}/${key}`)
    return key
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
