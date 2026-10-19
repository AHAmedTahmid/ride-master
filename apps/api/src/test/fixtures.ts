/**
 * Test-database lifecycle and fixtures for e2e specs.
 * Each e2e file calls resetAndSeed() in beforeAll: drops every table,
 * re-applies migrations, and inserts the minimal fixture world.
 */
import * as mysql from 'mysql2/promise'
import * as argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'
import { parseMysqlUrl, run } from '../database/migrate'
import { encryptSecret } from '../common/utils/crypto'
import { generateUlid } from '../common/utils/ulid'

/** Fixed TOTP secret so specs can generate codes on demand. */
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

export const TEST_ADMIN_PASSWORD = 'TestAdmin#123'

export const FIXTURES = {
  rider: { phone: '+9609991001', name: 'Rider One' },
  owner: { phone: '+9609991002', name: 'Owner One' },
  driver: { phone: '+9609991003', name: 'Driver One' },
  superadmins: {
    super: 'super@test.local',
    verifier: 'verifier@test.local',
    support: 'support@test.local',
    finance: 'finance@test.local',
  },
} as const

export async function resetAndSeed(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL_TEST
  if (!dbUrl) throw new Error('DATABASE_URL_TEST is not set')
  const config = parseMysqlUrl(dbUrl)

  const connection = await mysql.createConnection(config)
  const [tables] = await connection.execute<mysql.RowDataPacket[]>(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [config.database],
  )
  await connection.execute('SET FOREIGN_KEY_CHECKS = 0')
  for (const row of tables) {
    await connection.execute(`DROP TABLE \`${row.t}\``)
  }
  await connection.execute('SET FOREIGN_KEY_CHECKS = 1')
  await connection.end()

  await run()
  await seedFixtures()
}

async function seedFixtures(): Promise<void> {
  const passwordHash = await argon2.hash(TEST_ADMIN_PASSWORD, { type: argon2.argon2id })
  const totpEnc = encryptSecret(TEST_TOTP_SECRET)

  const prisma = new PrismaClient()
  try {
    for (const [level, email] of Object.entries(FIXTURES.superadmins)) {
      await prisma.user.create({
        data: {
          publicId: generateUlid(),
          fullName: `Admin ${level}`,
          email,
          phone: `+960999200${Object.keys(FIXTURES.superadmins).indexOf(level) + 1}`,
          passwordHash,
          totpSecretEnc: totpEnc,
          language: 'en',
          roles: {
            create: { publicId: generateUlid(), role: 'superadmin', adminLevel: level },
          },
        },
      })
    }

    await prisma.user.create({
      data: {
        publicId: generateUlid(),
        fullName: FIXTURES.rider.name,
        phone: FIXTURES.rider.phone,
        language: 'en',
        roles: { create: { publicId: generateUlid(), role: 'rider' } },
      },
    })

    const owner = await prisma.user.create({
      data: {
        publicId: generateUlid(),
        fullName: FIXTURES.owner.name,
        phone: FIXTURES.owner.phone,
        language: 'en',
      },
    })

    const company = await prisma.company.create({
      data: {
        publicId: generateUlid(),
        ownerUserId: owner.id,
        name: 'Azure Cabs',
        tradeName: 'Azure Cabs Pvt Ltd',
        licenceNumber: 'OP-AZ-0001',
        phone: FIXTURES.owner.phone,
        type: 'company',
        status: 'approved',
        isDemo: true,
      },
    })

    await prisma.userRole.create({
      data: {
        publicId: generateUlid(),
        userId: owner.id,
        role: 'company_owner',
        companyId: company.id,
      },
    })

    await prisma.user.create({
      data: {
        publicId: generateUlid(),
        fullName: FIXTURES.driver.name,
        phone: FIXTURES.driver.phone,
        language: 'en',
        roles: {
          create: { publicId: generateUlid(), role: 'driver', companyId: company.id },
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/** Generate the current TOTP code for the shared test secret. */
export async function currentTotpCode(): Promise<string> {
  const { Secret, TOTP } = await import('otpauth')
  const totp = new TOTP({
    issuer: 'Ride Master',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(TEST_TOTP_SECRET),
  })
  return totp.generate()
}
