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
  owner2: { phone: '+9609991004', name: 'Owner Two' },
  driver: { phone: '+9609991003', name: 'Driver One' },
  driver2: { phone: '+9609991005', name: 'Driver Two' },
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

    // Seed Areas & Vehicle Types
    const area = await prisma.area.create({
      data: {
        publicId: 'A-MALE',
        nameEn: 'Male',
        nameDv: 'Malé',
        geometry: 'POLYGON((0 0,0 1,1 1,1 0,0 0))',
      },
    })
    const vType = await prisma.vehicleType.create({
      data: { publicId: 'VT-CAR', name: 'Car', seats: 4 },
    })

    // Company 1
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

    // Company 2
    const owner2 = await prisma.user.create({
      data: {
        publicId: generateUlid(),
        fullName: FIXTURES.owner2.name,
        phone: FIXTURES.owner2.phone,
        language: 'en',
      },
    })

    const company2 = await prisma.company.create({
      data: {
        publicId: generateUlid(),
        ownerUserId: owner2.id,
        name: 'Blue Cabs',
        tradeName: 'Blue Cabs Pvt Ltd',
        licenceNumber: 'OP-BL-0002',
        phone: FIXTURES.owner2.phone,
        type: 'company',
        status: 'approved',
        isDemo: true,
      },
    })

    await prisma.userRole.create({
      data: {
        publicId: generateUlid(),
        userId: owner2.id,
        role: 'company_owner',
        companyId: company2.id,
      },
    })

    await prisma.user.create({
      data: {
        publicId: generateUlid(),
        fullName: FIXTURES.driver2.name,
        phone: FIXTURES.driver2.phone,
        language: 'en',
        roles: {
          create: { publicId: generateUlid(), role: 'driver', companyId: company2.id },
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
