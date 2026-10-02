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

// In a container stack the database can be unreachable for a moment after it reports
// healthy (its name not yet resolvable, or still starting). Wait for it rather than fail
// the deploy; a wrong password or a real outage still fails, after a minute.
const UNREACHABLE = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', '57P03'])
for (let attempt = 1; ; attempt += 1) {
  try {
    await pool.query('select 1')
    break
  } catch (error) {
    if (!UNREACHABLE.has(error.code) || attempt === 30) {
      await pool.end()
      throw error
    }
    if (attempt === 1) console.log(`Waiting for the database (${error.code})…`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

try {
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'api/_lib/db/migrations') })
  console.log('Migrations applied.')
} finally {
  await pool.end()
}
