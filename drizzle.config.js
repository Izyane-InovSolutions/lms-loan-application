import { defineConfig } from 'drizzle-kit'

// `npm run db:generate` diffs api/_lib/db/schema.js against the migrations folder and
// writes a new SQL migration. It needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './api/_lib/db/schema.js',
  out: './api/_lib/db/migrations',
})
