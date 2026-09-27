import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { getSetting } from './settings.js'
import { deleteBlobs } from './blob.js'

const { applications, applicationDocuments, auditLog } = schema

const DAY_MS = 24 * 60 * 60 * 1000

/** Deletes applications (their rows cascade) after removing their stored files. */
export const deleteApplications = async (ids) => {
  if (!ids.length) return 0
  const db = await getDb()
  const documents = await db
    .select({ url: applicationDocuments.url, pathname: applicationDocuments.pathname })
    .from(applicationDocuments)
    .where(inArray(applicationDocuments.applicationId, ids))
  // Sample documents are shared by every demo application; they stay.
  await deleteBlobs(documents.filter((document) => !String(document.pathname).startsWith('demo/'))).catch((error) =>
    console.warn(`[retention] some files were not removed: ${error?.message}`)
  )
  const removed = await db.delete(applications).where(inArray(applications.id, ids)).returning({ id: applications.id })
  return removed.length
}

// status → the settings field giving its retention, and the date it is counted from.
const RULES = [
  { status: 'declined', field: 'declinedDays', since: applications.decidedAt },
  { status: 'withdrawn', field: 'withdrawnDays', since: applications.withdrawnAt },
  { status: 'expired', field: 'expiredDays', since: applications.offerExpiresAt },
  { status: 'disbursed', field: 'disbursedDays', since: applications.updatedAt },
]

/**
 * Cron: removes closed applications older than their retention period (Settings → Data
 * retention), and audit entries older than its own period if one is set. Returns counts
 * per status. A period left empty keeps those records indefinitely.
 */
export const applyRetention = async () => {
  const policy = await getSetting('retention')
  const db = await getDb()
  const removed = {}
  for (const rule of RULES) {
    const days = policy[rule.field]
    if (!days) continue
    const cutoff = new Date(Date.now() - days * DAY_MS)
    const due = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.status, rule.status), or(lt(rule.since, cutoff), and(sql`${rule.since} is null`, lt(applications.updatedAt, cutoff)))))
      .limit(500)
    removed[rule.status] = await deleteApplications(due.map((row) => row.id))
  }
  if (policy.auditLogDays) {
    const cutoff = new Date(Date.now() - policy.auditLogDays * DAY_MS)
    const rows = await db.delete(auditLog).where(lt(auditLog.at, cutoff)).returning({ id: auditLog.id })
    removed.auditEntries = rows.length
  }
  const total = Object.values(removed).reduce((sum, count) => sum + count, 0)
  if (total) {
    await db.insert(auditLog).values({ actorLabel: 'System', action: 'retention.purged', detail: removed })
  }
  return removed
}
