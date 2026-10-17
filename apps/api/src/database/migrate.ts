#!/usr/bin/env ts-node
/**
 * Migration runner: reads .sql files in numeric order, applies each to the
 * target database (defaults to DATABASE_URL, uses DATABASE_URL_TEST in test env).
 * Tracks applied migrations in schema_migrations table.
 * Safe to run multiple times (idempotent via INSERT IGNORE on schema_migrations).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as mysql from 'mysql2/promise'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../../../../.env') })

const DB_URL =
  process.env.NODE_ENV === 'test'
    ? (process.env.DATABASE_URL_TEST ?? '')
    : (process.env.DATABASE_URL ?? '')

if (!DB_URL) {
  console.error('ERROR: DATABASE_URL is not set')
  process.exit(1)
}

function parseMysqlUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: u.username,
    password: u.password,
    database: u.pathname.replace(/^\//, ''),
    multipleStatements: true,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  }
}

async function run() {
  const config = parseMysqlUrl(DB_URL)
  const connection = await mysql.createConnection(config)

  console.info(`[migrate] Connected to ${config.database} @ ${config.host}`)

  // Ensure schema_migrations table exists (created in 001 but we need it before running 001)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      version    VARCHAR(50)    NOT NULL,
      applied_at DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_version (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `)

  // Get already-applied versions
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    'SELECT version FROM schema_migrations',
  )
  const applied = new Set(rows.map((r) => r.version as string))

  // Read migration files in order
  const migrationsDir = path.join(__dirname, 'migrations')
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let ran = 0
  for (const file of files) {
    const version = file.replace('.sql', '')
    if (applied.has(version)) {
      console.info(`[migrate] SKIP  ${file} (already applied)`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')

    // Split on semicolons to execute statements individually
    // (multipleStatements: true also works but explicit is safer with SPATIAL DDL)
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'))

    try {
      for (const stmt of statements) {
        if (stmt) {
          await connection.execute(stmt)
        }
      }
      console.info(`[migrate] APPLY ${file}`)
      ran++
    } catch (err) {
      console.error(`[migrate] FAILED on ${file}:`, err)
      await connection.end()
      process.exit(1)
    }
  }

  await connection.end()
  console.info(`[migrate] Done. ${ran} migration(s) applied.`)
}

run().catch((err) => {
  console.error('[migrate] Unexpected error:', err)
  process.exit(1)
})
