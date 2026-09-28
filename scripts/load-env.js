/*
 * Loads .env.local, then .env, into process.env for the npm scripts in this folder, so
 * `npm run db:migrate` finds the same DATABASE_URL the dev server uses. Values already
 * in the environment win, and .env.local wins over .env (loaded first; later files
 * never overwrite). Missing files are skipped.
 */
import fs from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) process.loadEnvFile(file)
}
