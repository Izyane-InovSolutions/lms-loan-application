import { and, desc, eq, inArray } from 'drizzle-orm'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, email as parseEmail } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { deleteApplications } from '../_lib/retention.js'
import { deleteBlobsForDraft } from '../_lib/blob.js'
import { isStaffRole } from '../../src/config/roles.js'

/*
 * Data subject requests under the Data Protection Act: find everything held about an
 * email address, export it, or erase it. Admin only, and every step is audited.
 *
 * Erasure is refused while any application is an approved, accepted or paid-out loan:
 * those are loan records the lender must keep. Everything else can be erased.
 */

const { applications, applicationDocuments, applicationEvents, consents, locations, users, auditLog, crbReports } = schema

const KEPT_STATUSES = ['approved', 'accepted', 'disbursed']

const collect = async (email) => {
  const db = await getDb()
  const [account] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (account && isStaffRole(account.role)) fail(400, 'This is a staff account. Manage staff from Team.', 'staff_account')
  const rows = await db.select().from(applications).where(eq(applications.applicantEmail, email)).orderBy(desc(applications.submittedAt))
  const ids = rows.map((row) => row.id)
  const [documents, events, consentRows, points, reports] = ids.length
    ? await Promise.all([
        db.select().from(applicationDocuments).where(inArray(applicationDocuments.applicationId, ids)),
        db.select().from(applicationEvents).where(and(inArray(applicationEvents.applicationId, ids), eq(applicationEvents.visibleToCustomer, true))),
        db.select().from(consents).where(inArray(consents.applicationId, ids)),
        db.select().from(locations).where(inArray(locations.applicationId, ids)),
        db.select().from(crbReports).where(inArray(crbReports.applicationId, ids)),
      ])
    : [[], [], [], [], []]
  const draft = await kv.get(`draft:${email}`)
  return { account, applications: rows, documents, events, consents: consentRows, locations: points, crbReports: reports, draft }
}

const summary = async (req, res, { query }) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  const email = parseEmail(query.get('email'))
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  const found = await collect(email)
  await recordAudit({ req, actor, action: 'privacy.searched', detail: { email } })
  const kept = found.applications.filter((row) => KEPT_STATUSES.includes(row.status))
  return {
    email,
    account: found.account ? { id: found.account.id, createdAt: found.account.createdAt, lastLoginAt: found.account.lastLoginAt } : null,
    applications: found.applications.map((row) => ({ id: row.id, reference: row.reference, status: row.status, loanType: row.loanType, amount: row.amount, submittedAt: row.submittedAt })),
    documents: found.documents.length,
    hasDraft: Boolean(found.draft),
    canErase: kept.length === 0,
    blockedBy: kept.map((row) => row.reference),
  }
}

/** Everything held, as one JSON file. Documents are listed; each can be downloaded from the case. */
const exportData = async (req, res, { query }) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  const email = parseEmail(query.get('email'))
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  const found = await collect(email)
  const strip = ({ submissionKey, url, pathname, lmsFileUrl, passwordHash, totpSecret, recoveryCodes, ...rest }) => rest
  const payload = {
    exportedAt: new Date().toISOString(),
    subject: email,
    account: found.account ? strip(found.account) : null,
    applications: found.applications.map(strip),
    documents: found.documents.map(strip),
    timeline: found.events,
    consents: found.consents,
    locations: found.locations,
    creditReports: found.crbReports,
    unfinishedDraft: found.draft ? { savedAt: found.draft.savedAt, loanType: found.draft.loanType, personalData: found.draft.personalData, businessData: found.draft.businessData } : null,
  }
  await recordAudit({ req, actor, action: 'privacy.exported', detail: { email, applications: found.applications.length } })
  const body = Buffer.from(JSON.stringify(payload, null, 2))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="personal-data-${email.replace(/[^a-z0-9@._-]/gi, '_')}.json"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.statusCode = 200
  res.end(body)
}

/** Erases applications, files, draft, consents and the customer account for an email. */
const erase = async (req) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  const email = parseEmail(req.body?.email)
  if (!email || req.body?.confirm !== email) fail(400, 'Type the email address again to confirm.', 'invalid_input')
  const found = await collect(email)
  const kept = found.applications.filter((row) => KEPT_STATUSES.includes(row.status))
  if (kept.length) fail(409, `Can’t erase: ${kept.map((row) => row.reference).join(', ')} ${kept.length === 1 ? 'is a loan record' : 'are loan records'} that must be kept.`, 'retention_required')

  const db = await getDb()
  const removedApplications = await deleteApplications(found.applications.map((row) => row.id))
  if (found.draft) {
    await deleteBlobsForDraft(found.draft).catch(() => {})
    await Promise.all([...new Set([...(found.draft.aliases || []), email])].map((key) => kv.del(`draft:${key}`)))
  }
  if (found.account) {
    // The audit trail stays (it is how the controller shows what happened), without the name.
    await db.update(auditLog).set({ actorLabel: 'Erased customer' }).where(eq(auditLog.actorId, found.account.id))
    await db.delete(users).where(eq(users.id, found.account.id))
  }
  await recordAudit({ req, actor, action: 'privacy.erased', detail: { applications: removedApplications, account: Boolean(found.account) } })
  return { erased: { applications: removedApplications, account: Boolean(found.account), draft: Boolean(found.draft) } }
}

export const privacyRoutes = [
  ['GET', '/admin/data-requests', summary],
  ['GET', '/admin/data-requests/export', exportData],
  ['POST', '/admin/data-requests/erase', erase],
]
