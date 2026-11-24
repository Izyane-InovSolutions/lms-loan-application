import { sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail } from './http.js'
import { isStaffRole } from '../../src/config/roles.js'

/**
 * Refuses an applicant's email that belongs to a staff account (any role but customer, in
 * any status), so staff can't apply as customers under their work email: they apply with
 * a personal one. Matched without regard to case.
 */
export const refuseStaffEmail = async (email) => {
  if (!email) return
  const db = await getDb()
  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${String(email).trim().toLowerCase()}`)
    .limit(1)
  if (user && isStaffRole(user.role)) fail(403, 'This email belongs to a staff account. Use a personal email to apply for a loan.', 'staff_account')
}
