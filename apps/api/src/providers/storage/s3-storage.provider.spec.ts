import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = vi.fn(async (cmd: { input: Record<string, unknown> }) => ({ ok: true, cmd }))
    },
    PutObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/url'),
}))

import { S3StorageProvider } from './s3-storage.provider'

describe('S3StorageProvider', () => {
  beforeEach(() => {
    process.env.STORAGE_ENDPOINT = 'http://localhost:9000'
    process.env.STORAGE_BUCKET = 'test-bucket'
  })

  it('put stores the object and returns its key', async () => {
    const provider = new S3StorageProvider()
    const key = await provider.put('docs/licence.pdf', Buffer.from('x'), 'application/pdf')
    expect(key).toBe('docs/licence.pdf')
  })

  it('getSignedUrl returns a presigned URL', async () => {
    const provider = new S3StorageProvider()
    const url = await provider.getSignedUrl('docs/licence.pdf', 300)
    expect(url).toBe('https://signed.example/url')
  })

  it('delete completes without error', async () => {
    const provider = new S3StorageProvider()
    await expect(provider.delete('docs/licence.pdf')).resolves.toBeUndefined()
  })
})
