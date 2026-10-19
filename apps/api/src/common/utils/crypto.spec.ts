import { describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  randomToken,
  sha256Hex,
} from './crypto'

describe('sha256Hex', () => {
  it('is deterministic and hex-encoded', () => {
    const a = sha256Hex('hello')
    expect(a).toBe(sha256Hex('hello'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})

describe('randomToken', () => {
  it('produces URL-safe tokens of the requested entropy', () => {
    const token = randomToken(48)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(64)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken(16)))
    expect(tokens.size).toBe(100)
  })
})

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const encrypted = encryptSecret(secret)
    expect(encrypted).not.toContain(secret)
    expect(decryptSecret(encrypted)).toBe(secret)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret))
  })

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encryptSecret('secret')
    const originalKey = process.env.APP_ENCRYPTION_KEY
    const originalJwt = process.env.JWT_SECRET
    process.env.APP_ENCRYPTION_KEY = 'a_different_key_for_this_test'
    process.env.JWT_SECRET = 'a_different_key_for_this_test'
    try {
      expect(() => decryptSecret(encrypted)).toThrow()
    } finally {
      process.env.APP_ENCRYPTION_KEY = originalKey
      process.env.JWT_SECRET = originalJwt
    }
  })

  it('fails to decrypt tampered ciphertext', () => {
    const encrypted = encryptSecret('secret')
    const raw = Buffer.from(encrypted, 'base64')
    raw[raw.length - 1] ^= 0xff
    expect(() => decryptSecret(raw.toString('base64'))).toThrow()
  })
})
