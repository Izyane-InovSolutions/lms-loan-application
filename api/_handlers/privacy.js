import crypto from 'node:crypto'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { unindexDraft } from '../_lib/drafts.js'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text, email as parseEmail } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { deleteApplications } from '../_lib/retention.js'
import { getSetting } from '../_lib/settings.js'
import { sealKey } from '../_lib/secrets.js'
import { deleteBlobsForDraft } from '../_lib/blob.js'
import { isStaffRole } from '../../src/config/roles.js'

/*
 * Data subject requests under the Data Protection Act: find everything held about an
 * email address, export it, or erase it. Admin only, and every step is audited.
 *
 * Erasure is refused while any application is an approved, accepted or paid-out loan:
 * those are loan records the lender must keep. Everything else can be erased.
 */

const { applications, applicationDocuments, applicationEvents, consents, locations, users, auditLog, crbReports, dataRequests } = schema

const KEPT_STATUSES = ['approved', 'accepted', 'disbursed']
const REQUEST_TYPES = ['access', 'erasure']
const REQUEST_STATUSES = ['open', 'in_progress', 'completed', 'rejected']
const DAY_MS = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keyed hash of an email address: lets the ledger recognise a person without holding the address. */
export const hashSubject = (email) => crypto.createHmac('sha256', sealKey('data-request-subject')).update(String(email).trim().toLowerCase()).digest('hex')

const publicRequest = (row) => ({
  id: row.id,
  emailHash: row.emailHash,
  type: row.type,
  status: row.status,
  receivedAt: row.receivedAt,
  dueAt: row.dueAt,
  handledBy: row.handledBy,
  outcome: row.outcome,
  completedAt: row.completedAt,
})

/** The ledger entry named by `requestId`, which must be for this email. Null when none is named. */
const linkedRequest = async (email, requestId) => {
  if (!requestId) return null
  if (!UUID.test(requestId)) fail(400, 'That request reference isn’t valid.', 'invalid_input')
  const db = await getDb()
  const [row] = await db.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1)
  if (!row) fail(404, 'That request isn’t in the ledger.', 'not_found')
  if (row.emailHash !== hashSubject(email)) fail(400, 'That ledger entry is for a different person.', 'request_mismatch')
  return row
}

/** Working on a request that is still open moves it to in progress. */
const markStarted = async (request, actor) => {
  if (request?.status !== 'open') return
  const db = await getDb()
  await db.update(dataRequests).set({ status: 'in_progress', handledBy: actor.id, updatedAt: new Date() }).where(eq(dataRequests.id, request.id))
}

/**
 * Why each loan record can't be erased yet, using the retention settings: how long the
 * lender keeps it, and when it falls due for automatic removal (null: not scheduled).
 */
const explainKept = async (rows) => {
  const policy = await getSetting('retention')
  const days = policy?.disbursedDays || null
  return rows.map((row) => {
    const since = row.updatedAt ? new Date(row.updatedAt) : null
    const until = row.status === 'disbursed' && days && since ? new Date(since.getTime() + days * DAY_MS).toISOString() : null
    const reason =
      row.status === 'disbursed'
        ? days
          ? `A paid-out loan, kept for ${days} days under the data retention settings.`
          : 'A paid-out loan. The data retention settings keep these indefinitely.'
        : `An ${row.status} loan that hasn’t been paid out yet. It becomes a loan record when it is, and the retention settings don’t remove it automatically.`
    return { reference: row.reference, status: row.status, reason, keptUntil: until }
  })
}

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
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  const email = parseEmail(query.get('email'))
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  const request = await linkedRequest(email, query.get('requestId'))
  const found = await collect(email)
  await recordAudit({ req, actor, action: 'privacy.searched', detail: { email, ...(request ? { requestId: request.id } : {}) } })
  await markStarted(request, actor)
  const kept = found.applications.filter((row) => KEPT_STATUSES.includes(row.status))
  return {
    email,
    account: found.account ? { id: found.account.id, createdAt: found.account.createdAt, lastLoginAt: found.account.lastLoginAt } : null,
    applications: found.applications.map((row) => ({ id: row.id, reference: row.reference, status: row.status, loanType: row.loanType, amount: row.amount, submittedAt: row.submittedAt })),
    documents: found.documents.length,
    hasDraft: Boolean(found.draft),
    canErase: kept.length === 0,
    blockedBy: kept.map((row) => row.reference),
    keptDetails: await explainKept(kept),
  }
}

/** Everything held, as one JSON file. Documents are listed; each can be downloaded from the case. */
const exportData = async (req, res, { query }) => {
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  const email = parseEmail(query.get('email'))
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  const request = await linkedRequest(email, query.get('requestId'))
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
  await recordAudit({ req, actor, action: 'privacy.exported', detail: { email, applications: found.applications.length, ...(request ? { requestId: request.id } : {}) } })
  await markStarted(request, actor)
  const body = Buffer.from(JSON.stringify(payload, null, 2))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="personal-data-${email.replace(/[^a-z0-9@._-]/gi, '_')}.json"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.statusCode = 200
  res.end(body)
}

/** What an erasure would remove, per category, without removing anything. */
const preview = async (req, res, { query }) => {
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  const email = parseEmail(query.get('email'))
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  const found = await collect(email)
  const kept = found.applications.filter((row) => KEPT_STATUSES.includes(row.status))
  await recordAudit({ req, actor, action: 'privacy.previewed', detail: { email } })
  return {
    email,
    canErase: kept.length === 0,
    counts: {
      applications: found.applications.length,
      documents: found.documents.length,
      consents: found.consents.length,
      locations: found.locations.length,
      crbReports: found.crbReports.length,
      draft: found.draft ? 1 : 0,
      account: found.account ? 1 : 0,
    },
    keptDetails: await explainKept(kept),
  }
}

/** Erases applications, files, draft, consents and the customer account for an email. */
const erase = async (req) => {
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  const email = parseEmail(req.body?.email)
  if (!email || req.body?.confirm !== email) fail(400, 'Type the email address again to confirm.', 'invalid_input')
  const request = await linkedRequest(email, req.body?.requestId)
  const found = await collect(email)
  const kept = found.applications.filter((row) => KEPT_STATUSES.includes(row.status))
  if (kept.length) {
    const [first] = await explainKept(kept)
    fail(409, `Can’t erase: ${kept.map((row) => row.reference).join(', ')} ${kept.length === 1 ? 'is a loan record' : 'are loan records'} that must be kept. ${first.reason}`, 'retention_required')
  }

  const db = await getDb()
  const removedApplications = await deleteApplications(found.applications.map((row) => row.id))
  if (found.draft) {
    await deleteBlobsForDraft(found.draft).catch(() => {})
    await Promise.all([...new Set([...(found.draft.aliases || []), email])].map((key) => kv.del(`draft:${key}`)))
    await unindexDraft(found.draft.id)
  }
  if (found.account) {
    // The audit trail stays (it is how the controller shows what happened), without the name.
    await db.update(auditLog).set({ actorLabel: 'Erased customer' }).where(eq(auditLog.actorId, found.account.id))
    await db.delete(users).where(eq(users.id, found.account.id))
  }
  await recordAudit({ req, actor, action: 'privacy.erased', detail: { applications: removedApplications, account: Boolean(found.account), ...(request ? { requestId: request.id } : {}) } })
  if (request && ['open', 'in_progress'].includes(request.status) && request.type === 'erasure') {
    await db
      .update(dataRequests)
      .set({ status: 'completed', handledBy: actor.id, completedAt: new Date(), updatedAt: new Date(), outcome: `Erased ${removedApplications} ${removedApplications === 1 ? 'application' : 'applications'}${found.account ? ' and the account' : ''}.` })
      .where(eq(dataRequests.id, request.id))
  }
  return { erased: { applications: removedApplications, account: Boolean(found.account), draft: Boolean(found.draft) } }
}

/** The ledger: filter by status/type, sort by due or received date, paginate. */
const listRequests = async (req, res, { query }) => {
  await requireUser(req, { permission: 'privacy.manage' })
  const db = await getDb()
  const status = query.get('status')
  const type = query.get('type')
  const filters = []
  if (status === 'active') filters.push(inArray(dataRequests.status, ['open', 'in_progress']))
  else if (REQUEST_STATUSES.includes(status)) filters.push(eq(dataRequests.status, status))
  if (REQUEST_TYPES.includes(type)) filters.push(eq(dataRequests.type, type))
  const where = filters.length ? and(...filters) : undefined
  const column = query.get('sort') === 'received' ? dataRequests.receivedAt : dataRequests.dueAt
  const order = query.get('dir') === 'desc' ? desc(column) : asc(column)
  const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize')) || 20))
  const page = Math.max(1, Number(query.get('page')) || 1)
  const [rows, [{ total }], [{ overdue }]] = await Promise.all([
    db.select().from(dataRequests).where(where).orderBy(order, desc(dataRequests.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql`count(*)::int` }).from(dataRequests).where(where),
    db.select({ overdue: sql`count(*)::int` }).from(dataRequests).where(and(inArray(dataRequests.status, ['open', 'in_progress']), sql`${dataRequests.dueAt} < now()`)),
  ])
  return { items: rows.map(publicRequest), total, page, pageSize, overdue }
}

const createRequest = async (req) => {
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  const email = parseEmail(req.body?.email)
  if (!email) fail(400, 'Enter the person’s email address.', 'invalid_input')
  if (!REQUEST_TYPES.includes(req.body?.type)) fail(400, 'Choose whether this is an access or an erasure request.', 'invalid_input')
  let receivedAt = new Date()
  if (req.body?.receivedAt) {
    receivedAt = new Date(req.body.receivedAt)
    if (Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + DAY_MS) fail(400, 'The date received isn’t valid.', 'invalid_input')
  }
  const db = await getDb()
  const [row] = await db
    .insert(dataRequests)
    .values({ emailHash: hashSubject(email), type: req.body.type, receivedAt, dueAt: new Date(receivedAt.getTime() + 30 * DAY_MS), handledBy: actor.id })
    .returning()
  // The address is left out of the entry; the audit trail records who logged it and what kind.
  await recordAudit({ req, actor, action: 'privacy.request_logged', entityType: 'data_request', entityId: row.id, detail: { type: row.type, dueAt: row.dueAt } })
  return publicRequest(row)
}

const updateRequest = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'privacy.manage' })
  if (!UUID.test(params.id)) fail(404, 'That request isn’t in the ledger.', 'not_found')
  const status = req.body?.status
  if (!REQUEST_STATUSES.includes(status)) fail(400, 'Choose a status.', 'invalid_input')
  const outcome = text(req.body?.outcome, 1000)
  if (status === 'rejected' && !outcome) fail(400, 'Say why the request was rejected.', 'invalid_input')
  const db = await getDb()
  const [existing] = await db.select().from(dataRequests).where(eq(dataRequests.id, params.id)).limit(1)
  if (!existing) fail(404, 'That request isn’t in the ledger.', 'not_found')
  const closing = status === 'completed' || status === 'rejected'
  const [row] = await db
    .update(dataRequests)
    .set({ status, outcome: outcome || existing.outcome, handledBy: actor.id, completedAt: closing ? new Date() : null, updatedAt: new Date() })
    .where(eq(dataRequests.id, params.id))
    .returning()
  await recordAudit({ req, actor, action: 'privacy.request_updated', entityType: 'data_request', entityId: row.id, detail: { from: existing.status, to: status } })
  return publicRequest(row)
}

export const privacyRoutes = [
  ['GET', '/admin/data-requests', summary],
  ['GET', '/admin/data-requests/export', exportData],
  ['GET', '/admin/data-requests/preview', preview],
  ['GET', '/admin/data-requests/ledger', listRequests],
  ['POST', '/admin/data-requests/ledger', createRequest],
  ['PATCH', '/admin/data-requests/ledger/:id', updateRequest],
  ['POST', '/admin/data-requests/erase', erase],
]
