import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto'

/**
 * Deterministic hash for high-entropy secrets (refresh tokens).
 * Refresh tokens are 48 random bytes — SHA-256 preimage resistance is
 * sufficient and allows O(1) lookup by hash. Low-entropy secrets (OTP
 * codes, passwords) always use argon2 instead.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** URL-safe random token (default 64 bytes = 512 bits). */
export function randomToken(bytes = 64): string {
  return randomBytes(bytes).toString('base64url')
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'ride-master-totp-enc', 32)
}

/**
 * AES-256-GCM encryption for TOTP secrets at rest.
 * Key derives from APP_ENCRYPTION_KEY (preferred) or JWT_SECRET (dev fallback).
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey(process.env.APP_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(payload: string): string {
  const key = deriveKey(process.env.APP_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret')
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
