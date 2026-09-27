/*
 * Applies pending migrations to the database in DATABASE_URL.
 *
 *   npm run db:migrate            (DATABASE_URL from the environment, .env.local or .env)
 *
 * Run before deploying a change that adds a migration. Local dev on PGlite migrates by
 * itself and does not need this.
 */
import './load-env.js'
import path from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = (process.env.DATABASE_URL || '').trim()
if (!url) {
  console.error('Set DATABASE_URL to the database to migrate.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'api/_lib/db/migrations') })
  console.log('Migrations applied.')
} finally {
  await pool.end()
}
