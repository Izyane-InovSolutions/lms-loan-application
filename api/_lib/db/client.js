import path from 'node:path'
import * as schema from './schema.js'

/*
 * One database handle per process.
 *
 *   DATABASE_URL set   any Postgres (Neon from the Vercel Marketplace, RDS, self-hosted)
 *                      through node-postgres. Migrate it with `npm run db:migrate`.
 *   unset, locally     in-process PGlite persisted to .local-pg/, migrated on first use,
 *                      so `npm run dev` needs no database install.
 *   unset, on Vercel   an error on first use. Each invocation has its own read-only
 *                      filesystem, so a file-backed database would silently lose data —
 *                      the same reasoning as kv.js.
 *
 * The handle is kept on globalThis because the dev server re-imports API modules after
 * edits; a second PGlite opening the same directory would corrupt it.
 */

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'api/_lib/db/migrations')
// LOS_PGLITE_DIR=memory:// gives tests a throwaway database.
const LOCAL_DATA_DIR = process.env.LOS_PGLITE_DIR || path.resolve(process.cwd(), '.local-pg')

const createPostgres = async (connectionString) => {
  const { default: pg } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  // Small pool: serverless instances are many and short-lived, and Neon's pooler (use the
  // -pooler host in DATABASE_URL) multiplexes them onto real connections.
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10000 })
  return drizzle(pool, { schema })
}

const createLocal = async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const client = await PGlite.create(LOCAL_DATA_DIR)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return db
}

const connect = () => {
  const url = (process.env.DATABASE_URL || '').trim()
  if (url) return createPostgres(url)
  if (process.env.VERCEL) {
    return Promise.reject(
      new Error(
        'No database is configured for this deployment. Add a Postgres database (Vercel → ' +
          'Storage → Marketplace → Neon, or your own) and set DATABASE_URL.'
      )
    )
  }
  return createLocal()
}

export const getDb = () => {
  if (!globalThis.__losDb) {
    globalThis.__losDb = connect().catch((error) => {
      // Let the next request try again instead of caching the failure.
      globalThis.__losDb = null
      throw error
    })
  }
  return globalThis.__losDb
}

export { schema }
