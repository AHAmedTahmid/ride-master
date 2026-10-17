#!/usr/bin/env ts-node
/**
 * Migration runner.
 *
 * - Applies .sql files in apps/api/src/database/migrations in numeric order.
 * - Tracks applied versions in schema_migrations (created if missing).
 * - Target database comes from DATABASE_URL, or DATABASE_URL_TEST when NODE_ENV=test.
 * - Never contains USE statements in migration files: the connection's default
 *   database is the target, so the same file set works for dev, test and prod.
 * - Statement splitter is quote- and comment-aware (strings, backticks, line and
 *   block comments).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as mysql from 'mysql2/promise'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../../../../.env') })

const isTest = process.env.NODE_ENV === 'test'
const DB_URL = (isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL) ?? ''

if (!DB_URL) {
  console.error(`ERROR: ${isTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL'} is not set`)
  process.exit(1)
}

function parseMysqlUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    multipleStatements: false,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  }
}

/**
 * Strip comments and split SQL text into individual statements.
 * Respects single quotes, double quotes and backtick identifiers so that
 * semicolons inside string literals do not split a statement.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    // Line comments: -- ... and # ...
    if (!inSingle && !inDouble && !inBacktick && (ch === '-' && next === '-')) {
      while (i < sql.length && sql[i] !== '\n') i++
      current += '\n'
      i++
      continue
    }
    if (!inSingle && !inDouble && !inBacktick && ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
      current += '\n'
      i++
      continue
    }
    // Block comments: /* ... */
    if (!inSingle && !inDouble && !inBacktick && ch === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }

    // Quote tracking (handles '' and "" and `` escapes)
    if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle
    else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble
    else if (!inSingle && !inDouble && ch === '`') inBacktick = !inBacktick

    // Statement boundary: semicolon outside quotes at depth 0
    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const stmt = current.trim()
      if (stmt.length > 0) statements.push(stmt)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  const tail = current.trim()
  if (tail.length > 0) statements.push(tail)
  return statements
}

async function run() {
  const config = parseMysqlUrl(DB_URL)
  const connection = await mysql.createConnection(config)

  console.info(`[migrate] Connected to ${config.database} @ ${config.host}:${config.port}`)

  // The runner owns schema_migrations (migration files must not create or write it).
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      version    VARCHAR(50)    NOT NULL,
      applied_at DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_version (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `)

  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    'SELECT version FROM schema_migrations',
  )
  const applied = new Set(rows.map((r) => r.version as string))

  // Safety: DDL cannot be rolled back. If the database has tables but no
  // recorded migrations, a previous run died halfway — refuse to guess.
  if (applied.size === 0) {
    const [tables] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name <> 'schema_migrations'",
      [config.database],
    )
    if (Number(tables[0].n) > 0) {
      console.error(
        `[migrate] Database '${config.database}' has ${tables[0].n} table(s) but no recorded migrations.\n` +
          `A previous migration run likely failed halfway. Drop and recreate the database, then re-run:\n` +
          `  DROP DATABASE ${config.database}; CREATE DATABASE ${config.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
      )
      await connection.end()
      process.exit(1)
    }
  }

  const migrationsDir = path.join(__dirname, 'migrations')
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let ran = 0
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) {
      console.info(`[migrate] SKIP  ${file}`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    const statements = splitSqlStatements(sql).filter((s) => !/^use\s/i.test(s))
    if (statements.length === 0) {
      console.warn(`[migrate] WARN  ${file} contains no statements`)
      continue
    }

    try {
      // MySQL DDL is non-transactional (each DDL statement implicit-commits),
      // so statements run sequentially with fail-fast behaviour.
      for (const stmt of statements) {
        await connection.execute(stmt)
      }
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version])
      console.info(`[migrate] APPLY ${file} (${statements.length} statements)`)
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
