import { eq, sql } from 'drizzle-orm'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { deleteApplications } from '../_lib/retention.js'
import { deleteBlobsForDraft } from '../_lib/blob.js'
import { verifyPassword } from '../_lib/auth/password.js'
import { features } from '../_lib/features.js'
import { WIPE_CATEGORIES, WIPE_KEYS, WIPE_PHRASE } from '../../src/config/dataWipe.js'

/*
 * Settings → Danger zone → Wipe data. Administrators only (the built-in admin role, not
 * any role with settings access), confirmed by typing WIPE and their password. Deletes
 * the chosen kinds of record with their stored files; configuration is never touched.
 * The wipe itself is always written to the audit log, after the log is cleared if that
 * was chosen, so there is a record of who wiped what.
 */

const { applications, applicationDrafts, users, notifications, dataRequests, errorReports, auditLog } = schema

const BATCH = 500

const count = async (db, table, where) => {
  const query = db.select({ total: sql`count(*)::int` }).from(table)
  const [row] = await (where ? query.where(where) : query)
  return row.total
}

const COUNTS = {
  applications: (db) => count(db, applications),
  drafts: (db) => count(db, applicationDrafts),
  customers: (db) => count(db, users, eq(users.role, 'customer')),
  notifications: (db) => count(db, notifications),
  dataRequests: (db) => count(db, dataRequests),
  errorReports: (db) => count(db, errorReports),
  auditLog: (db) => count(db, auditLog),
}

const WIPERS = {
  // In batches, each removing its applications' files first (retention.js); child rows cascade.
  async applications(db) {
    let removed = 0
    for (;;) {
      const batch = await db.select({ id: applications.id }).from(applications).limit(BATCH)
      if (!batch.length) return removed
      removed += await deleteApplications(batch.map((row) => row.id))
    }
  },
  // The saved draft (and its files) lives in the key-value store under the applicant's
  // email and any aliases; the table row is only its summary, which says where.
  async drafts(db) {
    const rows = await db.select({ id: applicationDrafts.id, email: applicationDrafts.email }).from(applicationDrafts)
    for (const row of rows) {
      const draft = await kv.get(`draft:${row.email}`)
      if (draft) {
        await deleteBlobsForDraft(draft).catch((error) => console.warn(`[wipe] some draft files were not removed: ${error?.message}`))
        await Promise.all([...new Set([...(draft.aliases || []), row.email])].map((key) => kv.del(`draft:${key}`)))
      }
    }
    await db.delete(applicationDrafts)
    return rows.length
  },
  // Their sessions cascade. A kept audit log keeps their entries, without their names.
  async customers(db) {
    await db.update(auditLog).set({ actorLabel: 'Erased customer' }).where(sql`${auditLog.actorId} in (select id from users where role = 'customer')`)
    const removed = await db.delete(users).where(eq(users.role, 'customer')).returning({ id: users.id })
    return removed.length
  },
  notifications: async (db) => (await db.delete(notifications).returning({ id: notifications.id })).length,
  dataRequests: async (db) => (await db.delete(dataRequests).returning({ id: dataRequests.id })).length,
  errorReports: async (db) => (await db.delete(errorReports).returning({ id: errorReports.id })).length,
  auditLog: async (db) => (await db.delete(auditLog).returning({ id: auditLog.id })).length,
}

// Switched off (LOS_DATA_WIPE_ENABLED, features.js): as if the endpoint weren't there.
const requireAdmin = (req) => {
  if (!features().dataWipe) fail(404, 'Not found.', 'not_found')
  return requireUser(req, { roles: ['admin'] })
}

/** How many records of each kind there are, for the choosing step. */
const summary = async (req) => {
  const actor = await requireAdmin(req)
  const db = await getDb()
  const counts = Object.fromEntries(await Promise.all(WIPE_KEYS.map(async (key) => [key, await COUNTS[key](db)])))
  // Sample-data and other password-less accounts confirm with the phrase alone.
  return { counts, needsPassword: Boolean(actor.passwordHash) }
}

const wipe = async (req) => {
  const actor = await requireAdmin(req)
  const chosen = WIPE_KEYS.filter((key) => (Array.isArray(req.body?.categories) ? req.body.categories : []).includes(key))
  if (!chosen.length) fail(400, 'Choose at least one kind of data to wipe.', 'invalid_input')
  if (text(req.body?.confirm, 20) !== WIPE_PHRASE) fail(400, `Type ${WIPE_PHRASE} to confirm.`, 'confirmation_required')
  if (actor.passwordHash && !(await verifyPassword(String(req.body?.password || ''), actor.passwordHash))) fail(400, 'That password isn’t right.', 'invalid_password')

  const db = await getDb()
  const removed = {}
  // Applications before customer accounts, and the audit log last, as listed.
  for (const key of chosen) removed[key] = await WIPERS[key](db)
  await recordAudit({
    req,
    actor,
    action: 'data.wiped',
    detail: { removed, labels: chosen.map((key) => WIPE_CATEGORIES.find((category) => category.key === key).label) },
  })
  return { removed }
}

export const dataWipeRoutes = [
  ['GET', '/admin/wipe', summary],
  ['POST', '/admin/wipe', wipe],
]
