export interface StorageProvider {
  /** Store an object and return its key. */
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string>
  /** Signed URL for private objects; expires in seconds. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(key: string): Promise<void>
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER'
