#!/usr/bin/env ts-node
/**
 * Development/demo seed.
 *
 * Creates a self-consistent demo world:
 *   - 4 superadmins, one per admin level (super | verifier | support | finance),
 *     each with an argon2 password and an encrypted TOTP secret
 *   - 5 service areas with polygon geometry (raw SQL — Prisma never maps GEOMETRY)
 *   - 3 vehicle types
 *   - 4 demo operators (3 companies + 1 individual), all approved
 *   - 12 drivers (the individual's owner doubles as its driver), 12 vehicles
 *   - 3 riders
 *   - suggested fares for every ordered area pair × vehicle type
 *   - one global commission rule
 *
 * The script refuses to run against a non-empty database. Everything it
 * creates is flagged is_demo where the column exists.
 */

import * as path from 'path'
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { ulid } from 'ulid'
import { encryptSecret } from '../common/utils/crypto'
import { TotpService } from '../modules/auth/totp.service'

dotenv.config({ path: path.join(__dirname, '../../../../.env') })

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'RideMaster#2026'

const prisma = new PrismaClient()
const totp = new TotpService()

interface AreaSeed {
  key: string
  nameEn: string
  nameDv: string
  type: string
  centerLng: number
  centerLat: number
  halfLng: number
  halfLat: number
}

const AREAS: AreaSeed[] = [
  { key: 'male', nameEn: 'Malé City', nameDv: 'މާލެނިކަރު', type: 'city', centerLng: 73.5093, centerLat: 4.1755, halfLng: 0.03, halfLat: 0.02 },
  { key: 'hulhumale', nameEn: 'Hulhumalé', nameDv: 'ހުޅުމާލެ', type: 'city', centerLng: 73.5309, centerLat: 4.2269, halfLng: 0.025, halfLat: 0.03 },
  { key: 'airport', nameEn: 'Velana International Airport', nameDv: 'ވެލަނަ އިންޓަރްނަޘަލް އެއަޅްޕޯށް', type: 'airport', centerLng: 73.5297, centerLat: 4.1918, halfLng: 0.01, halfLat: 0.01 },
  { key: 'maafushi', nameEn: 'Maafushi', nameDv: 'މާފުށި', type: 'island', centerLng: 73.4717, centerLat: 3.9734, halfLng: 0.012, halfLat: 0.008 },
  { key: 'villingili', nameEn: 'Villingili', nameDv: 'ވިލިންގިލި', type: 'island', centerLng: 73.4892, centerLat: 4.1766, halfLng: 0.01, halfLat: 0.008 },
]

interface VehicleSeed {
  plate: string
  make: string
  model: string
  year: number
  colour: string
  typeIndex: 0 | 1 | 2
}

const VEHICLES: VehicleSeed[] = [
  { plate: 'BG-1101', make: 'Toyota', model: 'Axio', year: 2021, colour: 'White', typeIndex: 0 },
  { plate: 'BG-1102', make: 'Toyota', model: 'Aqua', year: 2020, colour: 'Silver', typeIndex: 0 },
  { plate: 'BG-1103', make: 'Honda', model: 'Vezel', year: 2022, colour: 'Black', typeIndex: 1 },
  { plate: 'BG-1104', make: 'Toyota', model: 'Rush', year: 2021, colour: 'Grey', typeIndex: 1 },
  { plate: 'BG-2201', make: 'Toyota', model: 'Axio', year: 2019, colour: 'White', typeIndex: 0 },
  { plate: 'BG-2202', make: 'Suzuki', model: 'Wagon R', year: 2020, colour: 'Blue', typeIndex: 0 },
  { plate: 'BG-2203', make: 'Toyota', model: 'Hiace', year: 2018, colour: 'White', typeIndex: 2 },
  { plate: 'BG-2204', make: 'Honda', model: 'Vezel', year: 2021, colour: 'Red', typeIndex: 1 },
  { plate: 'BG-3301', make: 'Toyota', model: 'Axio', year: 2022, colour: 'Black', typeIndex: 0 },
  { plate: 'BG-3302', make: 'Toyota', model: 'Hiace', year: 2020, colour: 'Silver', typeIndex: 2 },
  { plate: 'BG-3303', make: 'Toyota', model: 'Rush', year: 2023, colour: 'White', typeIndex: 1 },
  { plate: 'BG-4401', make: 'Toyota', model: 'Aqua', year: 2021, colour: 'Grey', typeIndex: 0 },
]

interface DriverSeed {
  fullName: string
  phone: string
  companyIndex: 0 | 1 | 2 | 3
  vehicleIndex: number
}

const DRIVERS: DriverSeed[] = [
  { fullName: 'Faisal Naseer', phone: '+9609992001', companyIndex: 0, vehicleIndex: 0 },
  { fullName: 'Hussain Waheed', phone: '+9609992002', companyIndex: 0, vehicleIndex: 1 },
  { fullName: 'Ibrahim Zaki', phone: '+9609992003', companyIndex: 0, vehicleIndex: 2 },
  { fullName: 'Mariyam Shifa', phone: '+9609992004', companyIndex: 0, vehicleIndex: 3 },
  { fullName: 'Ahmed Latheef', phone: '+9609992005', companyIndex: 1, vehicleIndex: 4 },
  { fullName: 'Mohamed Didi', phone: '+9609992006', companyIndex: 1, vehicleIndex: 5 },
  { fullName: 'Ali Shafeeu', phone: '+9609992007', companyIndex: 1, vehicleIndex: 6 },
  { fullName: 'Zuleikha Mareer', phone: '+9609992008', companyIndex: 1, vehicleIndex: 7 },
  { fullName: 'Hassan Nazim', phone: '+9609992009', companyIndex: 2, vehicleIndex: 8 },
  { fullName: 'Ismail Careem', phone: '+9609992010', companyIndex: 2, vehicleIndex: 9 },
  { fullName: 'Aminath Jouhar', phone: '+9609992011', companyIndex: 2, vehicleIndex: 10 },
  { fullName: 'Hassan Ali', phone: '+9609991004', companyIndex: 3, vehicleIndex: 11 },
]

const SUP_ADMINS = [
  { fullName: 'Super Administrator', phone: '+9609990001', email: 'super@ridemaster.mv', level: 'super' },
  { fullName: 'Verification Officer', phone: '+9609990002', email: 'verifier@ridemaster.mv', level: 'verifier' },
  { fullName: 'Support Agent', phone: '+9609990003', email: 'support@ridemaster.mv', level: 'support' },
  { fullName: 'Finance Officer', phone: '+9609990004', email: 'finance@ridemaster.mv', level: 'finance' },
] as const

const OWNERS = [
  { fullName: 'Ahmed Rasheed', phone: '+9609991001', email: 'owner1@ridemaster.mv' },
  { fullName: 'Fathimath Zoona', phone: '+9609991002', email: 'owner2@ridemaster.mv' },
  { fullName: 'Ibrahim Kamal', phone: '+9609991003', email: 'owner3@ridemaster.mv' },
  { fullName: 'Hassan Ali', phone: '+9609991004', email: null },
]

const COMPANIES = [
  { name: 'Azure Cabs', tradeName: 'Azure Cabs Pvt Ltd', registrationNumber: 'MZ-PV-10021', licenceNumber: 'OP-AZ-0001' },
  { name: 'Sunset Transfers', tradeName: 'Sunset Transfers Pvt Ltd', registrationNumber: 'MZ-PV-10047', licenceNumber: 'OP-ST-0002' },
  { name: 'Atoll Rides', tradeName: 'Atoll Rides Pvt Ltd', registrationNumber: 'MZ-PV-10063', licenceNumber: 'OP-AR-0003' },
  { name: 'Hassan Ali', tradeName: null, registrationNumber: null, licenceNumber: 'OP-IN-0004' },
]

const RIDERS = [
  { fullName: 'Aminath Zoya', phone: '+9609993001' },
  { fullName: 'Mohamed Shafraz', phone: '+9609993002' },
  { fullName: 'Aisha Nasra', phone: '+9609993003' },
]

/** Fares: base + per-km, rounded up to the nearest 500 laari (MVR 5.00). */
const FARE_MODEL = [
  { base: 1500, perKm: 900 },
  { base: 2000, perKm: 1200 },
  { base: 2200, perKm: 1300 },
]

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function polygonWkt(a: AreaSeed): string {
  const w = a.centerLng - a.halfLng
  const e = a.centerLng + a.halfLng
  const s = a.centerLat - a.halfLat
  const n = a.centerLat + a.halfLat
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`
}

async function seedSuperadmins(): Promise<bigint> {
  const created: { id: bigint; email: string; secret: string; level: string }[] = []
  for (const a of SUP_ADMINS) {
    const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id })
    const { secret, otpauthUrl } = totp.generateSecret(a.email)
    const user = await prisma.user.create({
      data: {
        publicId: ulid(),
        fullName: a.fullName,
        phone: a.phone,
        email: a.email,
        passwordHash,
        totpSecretEnc: encryptSecret(secret),
        status: 'active',
        roles: {
          create: {
            publicId: ulid(),
            role: 'superadmin',
            adminLevel: a.level,
            status: 'active',
          },
        },
      },
    })
    created.push({ id: user.id, email: a.email, secret, level: a.level })
    console.info(`[seed] superadmin ${a.level.padEnd(8)} ${a.email}`)
    console.info(`        TOTP secret: ${secret}`)
    console.info(`        Enrol URL:   ${otpauthUrl}`)
  }
  const superRow = created.find((c) => c.level === 'super')
  if (!superRow) throw new Error('no superadmin created')
  return superRow.id
}

async function seedAreas(): Promise<Map<string, bigint>> {
  const ids = new Map<string, bigint>()
  for (const area of AREAS) {
    await prisma.$executeRaw`
      INSERT INTO areas (public_id, name_en, name_dv, type, geometry, active, is_demo)
      VALUES (${ulid()}, ${area.nameEn}, ${area.nameDv}, ${area.type}, ST_GeomFromText(${polygonWkt(area)}), 1, 1)
    `
    const row = await prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM areas WHERE name_en = ${area.nameEn}
    `
    ids.set(area.key, row[0].id)
  }
  console.info(`[seed] ${ids.size} service areas (polygon geometry)`)
  return ids
}

async function seedVehicleTypes(): Promise<bigint[]> {
  const defs = [
    { name: 'Sedan', seats: 4, luggage: 2 },
    { name: 'SUV', seats: 7, luggage: 4 },
    { name: 'Minivan', seats: 7, luggage: 6 },
  ]
  const ids: bigint[] = []
  for (const [i, d] of defs.entries()) {
    const vt = await prisma.vehicleType.create({
      data: {
        publicId: ulid(),
        name: d.name,
        seats: d.seats,
        luggageCapacity: d.luggage,
        sortOrder: i,
        isDemo: true,
      },
    })
    ids.push(vt.id)
  }
  console.info(`[seed] ${ids.length} vehicle types`)
  return ids
}

async function seedOwnersAndCompanies(superadminId: bigint, areaIds: Map<string, bigint>) {
  const ownerRows = []
  for (const o of OWNERS) {
    const user = await prisma.user.create({
      data: {
        publicId: ulid(),
        fullName: o.fullName,
        phone: o.phone,
        email: o.email,
        status: 'active',
        roles: {
          create: {
            publicId: ulid(),
            role: 'company_owner',
            status: 'active',
          },
        },
      },
    })
    ownerRows.push(user)
  }

  const companyIds: bigint[] = []
  for (const [i, c] of COMPANIES.entries()) {
    const individual = i === 3
    const company = await prisma.company.create({
      data: {
        publicId: ulid(),
        ownerUserId: ownerRows[i].id,
        type: individual ? 'individual' : 'company',
        name: c.name,
        tradeName: c.tradeName,
        registrationNumber: c.registrationNumber,
        licenceNumber: c.licenceNumber,
        phone: OWNERS[i].phone,
        email: OWNERS[i].email,
        status: 'approved',
        approvedBy: superadminId,
        approvedAt: new Date(),
        isDemo: true,
        serviceAreas: {
          create: [...areaIds.values()].map((areaId) => ({ areaId })),
        },
      },
    })
    companyIds.push(company.id)
    console.info(`[seed] ${individual ? 'individual' : 'company '} ${c.name}`)
  }
  return { companyIds, ownerRows }
}

async function seedRiders() {
  for (const r of RIDERS) {
    await prisma.user.create({
      data: {
        publicId: ulid(),
        fullName: r.fullName,
        phone: r.phone,
        status: 'active',
        roles: { create: { publicId: ulid(), role: 'rider', status: 'active' } },
      },
    })
  }
  console.info(`[seed] ${RIDERS.length} riders`)
}

async function seedDriversAndFleet(companyIds: bigint[], vehicleTypeIds: bigint[]) {
  const owners = await prisma.user.findMany({ where: { phone: { in: OWNERS.map((o) => o.phone) } } })
  const ownerByPhone = new Map(owners.map((o) => [o.phone, o]))

  for (const [i, d] of DRIVERS.entries()) {
    const licenceExpiry = new Date('2028-12-31T00:00:00.000Z')
    const insuranceExpiry = new Date('2027-06-30T00:00:00.000Z')
    const companyId = companyIds[d.companyIndex]
    const existingOwner = ownerByPhone.get(d.phone)

    let userId: bigint
    if (existingOwner) {
      // Individual owner doubles as their own driver (multi-role user).
      await prisma.userRole.create({
        data: {
          publicId: ulid(),
          userId: existingOwner.id,
          role: 'driver',
          companyId,
          status: 'active',
        },
      })
      userId = existingOwner.id
    } else {
      const user = await prisma.user.create({
        data: {
          publicId: ulid(),
          fullName: d.fullName,
          phone: d.phone,
          status: 'active',
          roles: {
            create: { publicId: ulid(), role: 'driver', companyId, status: 'active' },
          },
        },
      })
      userId = user.id
    }

    const driver = await prisma.driver.create({
      data: {
        publicId: ulid(),
        userId,
        companyId,
        licenceNumber: `DL-MV-${String(1000 + i)}`,
        licenceExpiry,
        status: 'active',
        isDemo: true,
      },
    })

    const v = VEHICLES[d.vehicleIndex]
    const vehicle = await prisma.vehicle.create({
      data: {
        publicId: ulid(),
        companyId,
        vehicleTypeId: vehicleTypeIds[v.typeIndex],
        plateNumber: v.plate,
        make: v.make,
        model: v.model,
        year: v.year,
        colour: v.colour,
        insuranceExpiry,
        status: 'active',
        isDemo: true,
      },
    })

    await prisma.driverVehicleAssignment.create({
      data: {
        publicId: ulid(),
        driverId: driver.id,
        vehicleId: vehicle.id,
        assignedFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    })

    await prisma.driverStatus.create({
      data: {
        driverId: driver.id,
        state: 'offline',
        currentVehicleId: vehicle.id,
        lastSeenAt: new Date(Date.now() - (i + 1) * 3 * 60 * 1000),
      },
    })
  }
  console.info(`[seed] ${DRIVERS.length} drivers, ${VEHICLES.length} vehicles`)
}

async function seedSuggestedFares(
  areaIds: Map<string, bigint>,
  vehicleTypeIds: bigint[],
  createdBy: bigint,
) {
  const areas = AREAS.map((a) => ({ ...a, id: areaIds.get(a.key)! }))
  const rows: {
    publicId: string
    fromAreaId: bigint
    toAreaId: bigint
    vehicleTypeId: bigint
    priceLaari: bigint
    createdBy: bigint
  }[] = []

  for (const from of areas) {
    for (const to of areas) {
      if (from.key === to.key) continue
      const km = haversineKm(from.centerLng, from.centerLat, to.centerLng, to.centerLat)
      for (const [t, model] of FARE_MODEL.entries()) {
        const raw = model.base + model.perKm * km
        const price = BigInt(Math.max(1500, Math.ceil(raw / 500) * 500))
        rows.push({
          publicId: ulid(),
          fromAreaId: from.id,
          toAreaId: to.id,
          vehicleTypeId: vehicleTypeIds[t],
          priceLaari: price,
          createdBy,
        })
      }
    }
  }
  await prisma.suggestedFare.createMany({ data: rows })
  console.info(`[seed] ${rows.length} suggested fares (${areas.length * (areas.length - 1)} route pairs × 3 vehicle types)`)
}

async function seedCommissionRule(superadminId: bigint) {
  await prisma.commissionRule.create({
    data: {
      publicId: ulid(),
      scope: 'global',
      percentBps: 1000,
      fixedFeeLaari: BigInt(0),
      validFrom: new Date(),
      createdBy: superadminId,
    },
  })
  console.info('[seed] global commission rule (10.00%)')
}

async function main() {
  const existing = await prisma.user.count()
  if (existing > 0) {
    console.error(
      `[seed] Database already has ${existing} user(s). Refusing to seed on top of existing data.\n` +
        'Run `pnpm --filter api db:reset` first if you want a clean demo world.',
    )
    process.exit(1)
  }

  console.info('[seed] Seeding demo world…')
  const superadminId = await seedSuperadmins()
  const areaIds = await seedAreas()
  const vehicleTypeIds = await seedVehicleTypes()
  const { companyIds } = await seedOwnersAndCompanies(superadminId, areaIds)
  await seedRiders()
  await seedDriversAndFleet(companyIds, vehicleTypeIds)
  await seedSuggestedFares(areaIds, vehicleTypeIds, superadminId)
  await seedCommissionRule(superadminId)

  console.info('')
  console.info('[seed] Done. Demo credentials (development only):')
  console.info(`[seed]   Superadmin password: ${ADMIN_PASSWORD}`)
  console.info('[seed]   Superadmin logins: super@ / verifier@ / support@ / finance@ridemaster.mv')
  console.info('[seed]   Riders log in by phone OTP (any +960 number works — codes print to the API console).')
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
