#!/usr/bin/env ts-node
/**
 * Database reset: drops every table in the target database and re-applies
 * all migrations. Refuses to run in production.
 *
 * Target database comes from DATABASE_URL, or DATABASE_URL_TEST when NODE_ENV=test.
 */

import * as path from 'path'
import * as dotenv from 'dotenv'
import * as mysql from 'mysql2/promise'
import { parseMysqlUrl, run } from './migrate'

dotenv.config({ path: path.join(__dirname, '../../../../.env') })

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[reset] Refusing to reset a production database')
    process.exit(1)
  }

  const isTest = process.env.NODE_ENV === 'test'
  const dbUrl = (isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL) ?? ''
  if (!dbUrl) {
    console.error(`ERROR: ${isTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL'} is not set`)
    process.exit(1)
  }

  const config = parseMysqlUrl(dbUrl)
  const connection = await mysql.createConnection(config)
  console.info(`[reset] Dropping all tables in ${config.database} @ ${config.host}:${config.port}`)

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

  console.info(`[reset] Dropped ${tables.length} table(s). Re-applying migrations…`)
  await run()
  console.info('[reset] Done. Run `pnpm --filter api db:seed` to create the demo world.')
}

main().catch((err) => {
  console.error('[reset] Unexpected error:', err)
  process.exit(1)
})
