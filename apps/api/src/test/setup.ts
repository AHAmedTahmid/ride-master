/**
 * Global test setup for both unit (vitest) and e2e (vitest.e2e.config) runs.
 * Loaded via vitest `setupFiles` before any test module is imported.
 */
import { config } from 'dotenv'
import * as path from 'path'

config({ path: path.resolve(__dirname, '../../../../.env') })

process.env.NODE_ENV = 'test'
// Point the app at the dedicated test database. migrate.ts also reads
// DATABASE_URL_TEST when NODE_ENV=test; Prisma always reads DATABASE_URL.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
}

process.env.JWT_SECRET ??= 'test_jwt_secret_0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.APP_ENCRYPTION_KEY ??= 'test_encryption_key_not_for_production'
process.env.JWT_ACCESS_TTL ??= '900'
process.env.JWT_REFRESH_TTL_DAYS ??= '7'
// Generous limits so test volume never trips Redis-backed OTP rate counters;
// rate-limit behaviour itself is tested with explicit low limits.
process.env.OTP_RATE_LIMIT_PER_HOUR ??= '10000'
process.env.RATE_LIMIT_MAX ??= '10000'
process.env.SMS_PROVIDER ??= 'console'
