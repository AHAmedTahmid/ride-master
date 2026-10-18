import { Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { Secret, TOTP } from 'otpauth'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 encoding for TOTP shared secrets. */
function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/**
 * TOTP (time-based one-time password) for superadmin 2FA.
 * Secrets are generated here, encrypted at rest by the caller, and
 * verified against the user's stored secret.
 */
@Injectable()
export class TotpService {
  private readonly issuer = 'Ride Master'

  generateSecret(email: string): { secret: string; otpauthUrl: string } {
    const secretBase32 = base32Encode(randomBytes(20))
    const totp = new TOTP({
      issuer: this.issuer,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secretBase32),
    })
    return { secret: secretBase32, otpauthUrl: totp.toString() }
  }

  verify(token: string, base32Secret: string): boolean {
    const totp = new TOTP({
      issuer: this.issuer,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(base32Secret),
    })
    return totp.validate({ token, window: 1 }) !== null
  }
}
