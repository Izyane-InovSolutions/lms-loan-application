import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text } from './http.js'
import { addEvent } from './applications.js'
import { getSetting, setSetting } from './settings.js'
import { getApplicationProduct } from './products.js'
import { caseWorkflow } from './workflow.js'
import { notifyUsers, creditStaffIds } from './notify.js'
import { rolesWith } from './roles.js'
import { collateralItems } from '../../src/config/collateral.js'
import { PARTNER_DOCUMENT_SLOTS, heldForPartner, heldReason, mayActOnHeldCase, normaliseNrc, partnerInactiveReason } from '../../src/config/partners.js'
import { currentDocuments } from '../../src/config/applications.js'
import { isZambian } from '../../src/config/applicantRules.js'

const { applications, applicationDocuments, partnerStaff, users } = schema

/*
 * Pre-approved loans for MoU partners' employees (src/config/partners.js): the partners
 * and their staff lists, putting a submitted case on the route, and the partner's staff
 * confirming or refusing their applicants. Issuing the offer is a case action
 * (issue_offer in workflow.js), so it enters the offer state as any approval does.
 */

export const listPartners = async () => (await getSetting('partners')).list || []

export const partnerById = async (id) => (await listPartners()).find((partner) => partner.id === id) || null

const zambian = (application) => isZambian(application?.data?.employmentInfo?.nationality)

/** The applicant's NRC, as the staff list stores it; none for someone who gave a passport. */
export const applicantNrc = (application) => (zambian(application) ? normaliseNrc(application?.data?.personalInfo?.nrc) : '')

/** Whether `nrc` is on the partner's current staff list, and what the list says about them. */
export const staffMatch = async (partner, nrc) => {
  const version = partner?.staffList?.version || 0
  const blank = { onList: false, employeeNumber: null, name: null, listVersion: version }
  if (!partner || !version || !nrc) return blank
  const db = await getDb()
  const [row] = await db
    .select()
    .from(partnerStaff)
    .where(and(eq(partnerStaff.partnerId, partner.id), eq(partnerStaff.listVersion, version), eq(partnerStaff.nrc, normaliseNrc(nrc))))
    .limit(1)
  return row ? { onList: true, employeeNumber: row.employeeNumber, name: row.name, listVersion: version } : blank
}

/**
 * Replaces a partner's staff list with `rows` (from parseStaffCsv): the new version is
 * written, the old one removed, and the partner's list details updated.
 */
export const replaceStaffList = async (partnerId, rows, actor) => {
  const setting = await getSetting('partners')
  const partner = (setting.list || []).find((entry) => entry.id === partnerId)
  if (!partner) fail(404, 'Partner not found.', 'not_found')
  const version = (partner.staffList?.version || 0) + 1
  const db = await getDb()
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += 500) {
      await tx.insert(partnerStaff).values(rows.slice(start, start + 500).map((row) => ({ partnerId, listVersion: version, nrc: row.nrc, employeeNumber: row.employeeNumber, name: row.name })))
    }
    await tx.delete(partnerStaff).where(and(eq(partnerStaff.partnerId, partnerId), ne(partnerStaff.listVersion, version)))
  })
  const staffList = { version, uploadedAt: new Date().toISOString(), uploadedByName: actor?.name || null, count: rows.length }
  await setSetting('partners', { ...setting, list: setting.list.map((entry) => (entry.id === partnerId ? { ...entry, staffList } : entry)) }, actor)
  return staffList
}

/** The active staff members of `partnerId` who confirm its employees. */
const partnerStaffIds = async (partnerId) => {
  const roleKeys = await rolesWith('partner.confirm')
  if (!roleKeys.length) return []
  const db = await getDb()
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roleKeys), eq(users.status, 'active'), eq(users.partnerId, partnerId)))
  return rows.map((row) => row.id)
}

/** Writes `preApproval` on the case if it hasn't changed since it was read. Returns the row, or null. */
const savePreApproval = async (db, application, preApproval, extra = {}) => {
  const [updated] = await db
    .update(applications)
    .set({ preApproval, ...extra, version: application.version + 1, updatedAt: new Date() })
    .where(and(eq(applications.id, application.id), eq(applications.version, application.version)))
    .returning()
  return updated || null
}

/**
 * After a case is submitted and pre-screened: puts it on the pre-approval route when its
 * product is pre-approved for a partner and the partner can take it, or records why not
 * (it is then worked as any other application). Only while the case is still where it
 * started, and not yet on or off the route. Returns the updated case, or null.
 */
export const enterPreApproval = async (applicationId, { origin } = {}) => {
  const db = await getDb()
  const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
  if (!application || application.status !== 'submitted') return null
  // Set as it was submitted (stage prescreen), or never set (a case from before that).
  if (application.preApproval && application.preApproval.stage !== 'prescreen') return null
  const product = await getApplicationProduct(application)
  const { flow } = await caseWorkflow(application)
  // No longer pre-approved, or already moved on: released to the usual review, never left held.
  const unavailable = !product?.preApproval?.enabled
    ? 'The product is no longer pre-approved.'
    : application.state !== flow.definition.start
      ? 'The case had already moved on.'
      : null
  if (unavailable) {
    if (!application.preApproval) return null
    const updated = await savePreApproval(db, application, { ...application.preApproval, stage: 'review', reason: unavailable, at: new Date().toISOString() })
    if (updated) await addEvent(db, { applicationId, actor: null, type: 'status', message: `Not pre-approved: ${unavailable} It goes through the usual review.` })
    return updated
  }

  const partner = await partnerById(product.preApproval.partnerId)
  const about = { partnerId: product.preApproval.partnerId, partnerName: partner?.name || null, mouReference: partner?.mouReference || null }
  const reason =
    partnerInactiveReason(partner) ||
    (collateralItems(application.data).length ? 'Collateral was pledged, so it needs valuing.' : null) ||
    (product.preApproval.maxAmount && application.amount > product.preApproval.maxAmount
      ? `K${application.amount.toLocaleString()} was asked for, above the pre-approved limit of K${product.preApproval.maxAmount.toLocaleString()}.`
      : null)

  if (reason) {
    const updated = await savePreApproval(db, application, { ...about, stage: 'review', reason, at: new Date().toISOString() })
    if (updated) await addEvent(db, { applicationId, actor: null, type: 'status', message: `Not pre-approved: ${reason} It goes through the usual review.` })
    return updated
  }

  const match = await staffMatch(partner, applicantNrc(application))
  const updated = await savePreApproval(db, application, { ...about, stage: 'partner', staffMatch: match, enteredAt: new Date().toISOString() })
  if (!updated) return null
  await addEvent(db, {
    applicationId,
    actor: null,
    type: 'status',
    message: `Pre-approved product: sent to ${partner.name} to confirm employment (${match.onList ? `on their staff list${match.employeeNumber ? `, employee no. ${match.employeeNumber}` : ''}` : 'not on their staff list'}).`,
  })
  await notifyUsers(
    await partnerStaffIds(partner.id),
    { type: 'partner_request', title: `Please confirm ${application.applicantName} works at ${partner.name}`, body: `Pre-approved loan of K${application.amount.toLocaleString()}`, applicationId },
    { origin }
  )
  return updated
}

/** The stage a pre-approved product's case starts in, as it is submitted: held while it is pre-screened. */
export const initialPreApproval = async (product) => {
  if (!product?.preApproval?.enabled) return null
  const partner = await partnerById(product.preApproval.partnerId)
  return { stage: 'prescreen', partnerId: product.preApproval.partnerId, partnerName: partner?.name || null, mouReference: partner?.mouReference || null, enteredAt: new Date().toISOString() }
}

/**
 * Refuses anyone but a system administrator who tries to validate or review a case held
 * for its partner (pre-screening, then waiting for the partner). The partner's own staff
 * answer on Partner requests, never on the case.
 */
export const assertNotHeld = (viewer, application) => {
  if (heldForPartner(application) && !mayActOnHeldCase(viewer)) fail(409, heldReason(application), 'held_for_partner')
}

/** Takes a case off the route, to the usual review; `tx` may be a transaction. For the workflow's own actions. */
export const offRoute = (application, reason, viewer) => ({
  ...application.preApproval,
  stage: 'review',
  reason,
  movedBy: viewer?.name || null,
  at: new Date().toISOString(),
})

// ---------------------------------------------------------------------------
// The partner's staff
// ---------------------------------------------------------------------------

/** Which partner's requests `viewer` answers: their own partner, or every partner for workspace-wide staff. */
const partnerFilter = (viewer) => {
  if (viewer.scope === 'all') return sql`${applications.preApproval} is not null`
  if (viewer.scope !== 'partner' || !viewer.partnerId) return sql`false`
  return sql`${applications.preApproval}->>'partnerId' = ${viewer.partnerId}`
}

/** Only what the partner needs to say whether this person works there. */
const toRequest = (row) => ({
  id: row.id,
  reference: row.reference,
  version: row.version,
  applicantName: row.applicantName,
  nrc: zambian(row) ? row.data?.personalInfo?.nrc || null : null,
  passportNumber: zambian(row) ? null : row.data?.personalInfo?.passportNumber || null,
  employerName: row.data?.employmentInfo?.employerName || null,
  amount: row.amount,
  tenure: row.tenure,
  monthlyInstalment: row.monthlyInstalment,
  submittedAt: row.submittedAt,
  partnerId: row.preApproval?.partnerId,
  partnerName: row.preApproval?.partnerName,
  stage: row.preApproval?.stage,
  staffMatch: row.preApproval?.staffMatch || null,
  partnerDecision: row.preApproval?.partnerDecision || null,
})

/** pending: waiting for the partner. recent: the last 50 the partner answered. */
export const partnerRequests = async (viewer, view = 'pending') => {
  const db = await getDb()
  const stage =
    view === 'recent'
      ? sql`${applications.preApproval}->'partnerDecision' is not null`
      : sql`${applications.preApproval}->>'stage' = 'partner' and ${applications.status} = 'submitted'`
  const rows = await db
    .select()
    .from(applications)
    .where(and(partnerFilter(viewer), stage))
    .orderBy(view === 'recent' ? desc(applications.updatedAt) : applications.submittedAt)
    .limit(view === 'recent' ? 50 : 200)
  return rows.map(toRequest)
}

/** One of the viewer's partner's applications, still waiting for their answer; 404 otherwise. */
const pendingRequest = async (viewer, applicationId) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(applicationId))) fail(404, 'Request not found.', 'not_found')
  const db = await getDb()
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), partnerFilter(viewer)))
    .limit(1)
  // Only while it waits for them: once answered, the application's details are no longer theirs to see.
  if (!application || application.preApproval?.stage !== 'partner' || application.status !== 'submitted') fail(404, 'Request not found, or already answered.', 'not_found')
  return application
}

/** The documents a partner sees: identity and payslips (PARTNER_DOCUMENT_SLOTS), newest copies only. */
const partnerDocuments = async (applicationId) => {
  const db = await getDb()
  const rows = await db.select().from(applicationDocuments).where(and(eq(applicationDocuments.applicationId, applicationId), inArray(applicationDocuments.slot, PARTNER_DOCUMENT_SLOTS)))
  return currentDocuments(rows.filter((row) => row.source !== 'system'))
}

/**
 * What the partner checks against their own records: who the person is, what they said
 * about their job, and their ID, photo and payslips. Nothing else of the application.
 */
export const partnerRequestDetail = async (viewer, applicationId) => {
  const application = await pendingRequest(viewer, applicationId)
  const personal = application.data?.personalInfo || {}
  const employment = application.data?.employmentInfo || {}
  const documents = await partnerDocuments(application.id)
  return {
    ...toRequest(application),
    applicant: {
      firstName: personal.firstName || null,
      middleName: personal.middleName || null,
      surname: personal.surname || null,
      nationality: employment.nationality || 'Zambia',
      birthDate: personal.birthDate || null,
      phone: personal.phone || null,
      occupation: employment.occupation || null,
      employerName: employment.employerName || null,
    },
    documents: documents.map((row) => ({ id: row.id, slot: row.slot, label: row.label, filename: row.filename, contentType: row.contentType })),
  }
}

/** One of those documents, for streaming to the partner's staff. */
export const partnerRequestDocument = async (viewer, applicationId, documentId) => {
  const application = await pendingRequest(viewer, applicationId)
  const document = (await partnerDocuments(application.id)).find((row) => row.id === documentId)
  if (!document) fail(404, 'Document not found.', 'not_found')
  return { application, document }
}

/**
 * The partner's answer: `confirm` (the applicant works there) moves the case to offer
 * issuance; `refuse` (with a reason) takes it off the route to the usual review.
 */
export const decideRequest = async (viewer, applicationId, input, { origin } = {}) => {
  const db = await getDb()
  if (!/^[0-9a-f-]{36}$/i.test(String(applicationId))) fail(404, 'Request not found.', 'not_found')
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), partnerFilter(viewer)))
    .limit(1)
  if (!application) fail(404, 'Request not found.', 'not_found')
  if (application.preApproval?.stage !== 'partner' || application.status !== 'submitted') fail(409, 'This request has already been answered, or the case has moved on.', 'invalid_state')
  if (Number(input.version) !== application.version) fail(409, 'This request has changed. Refresh and try again.', 'stale')
  const confirmed = input.decision === 'confirm'
  if (!confirmed && input.decision !== 'refuse') fail(400, 'Confirm or refuse the request.', 'invalid_input')
  const note = text(input.note, 500)
  if (!confirmed && note.length < 3) fail(400, 'Say why you can’t confirm this person.', 'note_required')
  const employeeNumber = text(input.employeeNumber, 40) || application.preApproval.staffMatch?.employeeNumber || null
  const partnerDecision = { confirmed, note: note || null, employeeNumber: confirmed ? employeeNumber : null, byName: viewer.name, by: viewer.id, at: new Date().toISOString() }
  const partnerName = application.preApproval.partnerName
  const next = confirmed
    ? { ...application.preApproval, stage: 'issue', partnerDecision }
    : { ...application.preApproval, stage: 'review', partnerDecision, reason: `${partnerName} did not confirm employment: ${note}` }
  const updated = await savePreApproval(db, application, next)
  if (!updated) fail(409, 'This request has changed. Refresh and try again.', 'stale')
  await addEvent(db, {
    applicationId,
    actor: viewer,
    type: 'status',
    message: confirmed
      ? `${partnerName} confirmed employment${employeeNumber ? ` (employee no. ${employeeNumber})` : ''}${note ? `: ${note}` : ''}. Ready to issue the offer.`
      : `${partnerName} did not confirm employment: ${note}. It goes through the usual review.`,
  })
  if (confirmed) {
    await notifyUsers(
      await creditStaffIds({ permission: 'offers.issue' }),
      { type: 'pre_approval_ready', title: `Issue the offer: ${application.reference}`, body: `${application.applicantName}, confirmed by ${partnerName}`, applicationId },
      { origin }
    )
  }
  return toRequest(updated)
}
