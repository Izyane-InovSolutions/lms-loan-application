/*
 * Creates (or re-activates) an administrator in the database in DATABASE_URL.
 *
 *   npm run create-admin -- admin@example.com "Full Name"   (DATABASE_URL from the environment, .env.local or .env)
 *
 * Prompts for the password so it never lands in shell history. For local dev on PGlite
 * this is unnecessary: set LOS_ADMIN_EMAIL / LOS_ADMIN_PASSWORD in .env and sign in, or
 * use the demo role switcher on the sign-in page.
 */
import './load-env.js'
import readline from 'node:readline/promises'
import pg from 'pg'
import { hashPassword } from '../api/_lib/auth/password.js'

const [emailArg, ...nameParts] = process.argv.slice(2)
const email = String(emailArg || '').trim().toLowerCase()
const name = nameParts.join(' ').trim() || 'Administrator'
const url = (process.env.DATABASE_URL || '').trim()

if (!url || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: DATABASE_URL=postgres://… npm run create-admin -- admin@example.com "Full Name"')
  process.exit(1)
}

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
const password = await prompt.question('Password (12+ characters): ')
prompt.close()

const passwordHash = await hashPassword(password)
const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  await pool.query(
    `INSERT INTO users (email, name, role, status, password_hash)
     VALUES ($1, $2, 'admin', 'active', $3)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active', password_hash = $3, updated_at = now()`,
    [email, name, passwordHash]
  )
  console.log(`Administrator ${email} is ready to sign in.`)
} finally {
  await pool.end()
}
