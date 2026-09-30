import crypto from 'node:crypto'
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text, email as parseEmail } from '../_lib/http.js'
import { requireUser, staffWith } from '../_lib/rbac.js'
import { activeUser, attributionFor, resolveReferral } from '../_lib/attribution.js'
import { unindexDraft } from '../_lib/drafts.js'
import { ensureOfferDocuments } from '../_lib/offerDocuments.js'
import { signaturesOf } from '../_lib/signing.js'
import { TEMPLATE_KIND_KEYS } from '../../src/config/templates.js'
import { recordAudit } from '../_lib/audit.js'
import { copyBlob, deleteBlobsForDraft, readBlob } from '../_lib/blob.js'
import { afterResponse } from '../_lib/after.js'
import { addEvent, applicantFromData, findVisibleApplication, nextReference, scopeApplications } from '../_lib/applications.js'
import { getLms } from '../_lib/lms/index.js'
import { queueLmsSyncIfDue, syncApplicationToLms } from '../_lib/lms/sync.js'
import { runPrescreen } from '../_lib/prescreen/run.js'
import { priceLoan } from '../../src/config/loanProducts.js'
import { getProductConfig, getProducts } from '../_lib/products.js'
import { APPLICATION_STATUSES, APPROVED_STATUSES, OPEN_STATUSES, WITHDRAWABLE_STATUSES, describeSlot, requiredSlots, slotFromDraftPath } from '../../src/config/applications.js'
import { isStaffRole } from '../../src/config/roles.js'
import { CONSENT_NOTICES } from '../../src/config/consent.js'
import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { clientIp } from '../_lib/http.js'
import { getCrb } from '../_lib/crb/index.js'
import { currentConsentVersion } from '../_lib/legal.js'
import { getSetting } from '../_lib/settings.js'
import { creditStaffIds, notifyUsers } from '../_lib/notify.js'
import { appOrigin } from '../_lib/http.js'
import { mapApplicationToFormState, selectLatestApplication } from '../../src/utils/applicationPrefillMapper.js'

const { applications, applicationDocuments, applicationEvents, users, prescreens, appraisals, consents, locations, crbReports } = schema
const sourcer = alias(users, 'sourcer')
const officer = alias(users, 'officer')
const rmUser = alias(users, 'rm_user')

const DRAFT_MARKER = '__draftFile__'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bearer = (req) => {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

/** The email a draft token belongs to, or null. */
const draftEmailFor = async (token) => (token ? kv.get(`draftToken:${token}`) : null)

/** Draft paths of the files still attached in the submitted data (a removed file can linger in the draft record). */
const attachedDraftPaths = (value, found = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => attachedDraftPaths(item, found))
  else if (value && typeof value === 'object') {
    if (typeof value[DRAFT_MARKER] === 'string') found.add(value[DRAFT_MARKER])
    else Object.values(value).forEach((child) => attachedDraftPaths(child, found))
  }
  return found
}

/** Replaces attachment markers with null — for prefill, where files must be attached afresh. */
const stripAttachments = (value) => {
  if (Array.isArray(value)) return value.map(stripAttachments)
  if (value && typeof value === 'object') {
    if (DRAFT_MARKER in value) return null
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stripAttachments(child)]))
  }
  return value
}

const deleteDraft = async (email, draft, token) => {
  const aliases = [...new Set([...(draft?.aliases || []), email])]
  await Promise.all(aliases.map((key) => kv.del(`draft:${key}`)))
  if (token) await kv.del(`draftToken:${token}`)
  await unindexDraft(draft?.id)
  if (draft) await deleteBlobsForDraft(draft).catch((error) => console.warn(`[submit] draft files not removed: ${error?.message}`))
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * POST /applications — files a completed application.
 *
 * Authorised by the draft token of the draft holding the files. The body is the wizard's
 * state with attachments as draft markers:
 *   { submissionKey, loanType, data, loanData: { amount, tenure }, referralCode?,
 *     consents: { dataProcessing, location, crb }, location?: { latitude, longitude, accuracy },
 *     assisted?, consentCode? }
 *
 * Assisted (a DSA or RM filling it in with the customer): the staff session is sent
 * alongside, the application is credited to them, and the customer's agreement is shown
 * by the code emailed to them (POST /api/otp/request, purpose "consent"), which they read
 * back to the agent.
 *
 * `submissionKey` makes this idempotent: the same key returns the application already
 * filed, so a retry after a dropped connection can never file the loan twice.
 */
const submitApplication = async (req) => {
  const body = req.body || {}
  const token = bearer(req)
  const tokenEmail = await draftEmailFor(token)
  if (!tokenEmail) fail(401, 'Your session has expired. Save your application again and resubmit.', 'invalid_token')
  const session = body.assisted ? await staffWith(req, 'applications.assist') : null
  if (body.assisted && !session) {
    fail(403, 'Your role can’t submit applications for customers. Sign in as an agent or relationship manager (with two-step sign-in set up, if your role needs it).', 'forbidden')
  }
  // Only set for assisted submissions; everything else is the applicant acting for themselves.
  const staff = session

  const submissionKey = text(body.submissionKey, 100)
  const loanType = body.loanType
  const data = body.data
  const amount = Number(body.loanData?.amount)
  const tenure = Number(body.loanData?.tenure)
  if (submissionKey.length < 8) fail(400, 'Missing submission key.', 'invalid_input')
  if (!['personal', 'business'].includes(loanType) || !data || typeof data !== 'object') fail(400, 'Choose a loan product.', 'invalid_input')

  const db = await getDb()
  const [existing] = await db.select().from(applications).where(eq(applications.submissionKey, submissionKey)).limit(1)
  if (existing) return { id: existing.id, reference: existing.reference, duplicate: true }

  const product = await getProductConfig(loanType)
  if (!product?.enabled) fail(400, 'This loan product isn’t available at the moment.', 'product_unavailable')
  if (!Number.isFinite(amount) || amount < product.minAmount || amount > product.maxAmount) {
    fail(400, `Choose an amount between K${product.minAmount.toLocaleString()} and K${product.maxAmount.toLocaleString()}.`, 'invalid_amount')
  }
  if (!Number.isInteger(tenure) || tenure < product.minTenure || tenure > product.maxTenure) {
    fail(400, `Choose a tenure between ${product.minTenure} and ${product.maxTenure} months.`, 'invalid_tenure')
  }
  const price = priceLoan(amount, tenure, product)

  const applicant = applicantFromData(loanType, data)
  if (applicant.name.length < 2 || !parseEmail(applicant.email)) fail(400, 'The applicant’s name and email are required.', 'invalid_input')

  // The files are in the draft kept under the applicant's email — built by the applicant,
  // or by the agent on their behalf.
  const draftEmail = tokenEmail
  if (tokenEmail !== applicant.email) {
    fail(409, 'The email on your application changed since it was last saved. Wait a moment and submit again.', 'email_changed')
  }
  const draft = await kv.get(`draft:${draftEmail}`)
  const attached = attachedDraftPaths(data)
  const slotRefs = {}
  Object.entries(draft?.documents || {}).forEach(([path, ref]) => {
    const slot = slotFromDraftPath(path)
    if (slot && attached.has(path)) slotRefs[slot] = ref
  })
  const missing = requiredSlots(loanType, data).filter((slot) => !slotRefs[slot])
  if (missing.length) {
    fail(
      400,
      `These documents haven’t finished uploading: ${missing.map((slot) => describeSlot(loanType, slot).label).join(', ')}. Wait a moment and submit again.`,
      'missing_documents'
    )
  }

  const wanted = body.consents || {}
  if (!wanted.dataProcessing) fail(400, 'Please accept the terms before submitting.', 'consent_required')
  if (staff) {
    const code = text(body.consentCode, 12)
    if (!code) fail(400, 'Enter the code we emailed to the customer to confirm they agree.', 'consent_code_required')
    const otpError = await checkOtp({ email: applicant.email, code, purpose: 'consent', req })
    if (otpError) fail(otpError.status, otpError.message.replace('The code entered', 'The customer’s code'), 'invalid_consent_code')
  }
  const point = wanted.location ? body.location : null
  const pointValid =
    point && Number.isFinite(Number(point.latitude)) && Math.abs(Number(point.latitude)) <= 90 && Number.isFinite(Number(point.longitude)) && Math.abs(Number(point.longitude)) <= 180

  // Attribution: staff entering it themselves, else a referral code from the link they followed.
  // A draft an agent started stays theirs when the customer finishes it on their own.
  let attribution = await attributionFor(null)
  const draftStarter = draft?.attribution?.startedByStaff ? await activeUser(draft.attribution.sourcedBy) : null
  if (staff) attribution = await attributionFor(staff, staff.referralCode)
  else if (draftStarter) attribution = await attributionFor(draftStarter, draftStarter.referralCode)
  else if (body.referralCode) {
    const referrer = await resolveReferral(body.referralCode)
    if (referrer) attribution = await attributionFor(referrer, referrer.referralCode)
  }

  const id = crypto.randomUUID()
  const documentRows = []
  for (const [slot, ref] of Object.entries(slotRefs)) {
    const described = describeSlot(loanType, slot)
    const copied = await copyBlob(ref, `applications/${id}/${slot}-${ref.filename}`)
    const kept = await kv.get(`aiAnalysis:${draftEmail}:${slot}`)
    documentRows.push({
      applicationId: id,
      slot,
      docType: described.docType,
      label: described.label,
      pathname: copied.pathname,
      url: copied.url,
      filename: ref.filename,
      contentType: ref.contentType || null,
      size: ref.size || null,
      source: staff ? 'staff' : 'applicant',
      uploadedBy: staff?.id ?? null,
      // Only the server's own analysis of this exact file (same name and size) is kept.
      aiAnalysis: kept && kept.filename === ref.filename && kept.size === ref.size ? kept.analysis : null,
    })
  }

  const [customer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, applicant.email), eq(users.role, 'customer')))
    .limit(1)

  const lmsConfigured = Boolean(await getLms())
  // The terms and privacy notice versions in force right now are what the applicant saw.
  const dataProcessingVersion = await currentConsentVersion()
  const application = await db.transaction(async (tx) => {
    const reference = await nextReference(tx)
    const [row] = await tx
      .insert(applications)
      .values({
        id,
        reference,
        submissionKey,
        loanType,
        customerId: customer?.id ?? null,
        applicantEmail: applicant.email,
        applicantName: applicant.name,
        applicantPhone: applicant.phone,
        companyName: applicant.companyName,
        amount,
        tenure,
        totalRepayable: price.total,
        monthlyInstalment: price.monthly,
        data,
        ...attribution,
        lmsSyncStatus: lmsConfigured ? 'waiting' : 'not_configured',
      })
      .returning()
    if (documentRows.length) await tx.insert(applicationDocuments).values(documentRows)
    const method = staff ? 'customer_code' : 'applicant_checkbox'
    const consentRows = [
      { type: 'data_processing', granted: true },
      // Agreed on the first step: staff could see the draft and contact them about it.
      ...(draft?.contactConsent ? [{ type: 'draft_contact', granted: true }] : []),
      { type: 'location', granted: Boolean(wanted.location && pointValid) },
      ...(getCrb() ? [{ type: 'crb', granted: Boolean(wanted.crb) }] : []),
    ].map((consent) => ({
      ...consent,
      applicationId: id,
      noticeVersion: consent.type === 'data_processing' ? dataProcessingVersion : consent.type === 'draft_contact' ? draft.contactConsent.version : CONSENT_NOTICES[consent.type].version,
      method,
      capturedBy: staff?.id ?? null,
      ip: clientIp(req),
    }))
    await tx.insert(consents).values(consentRows)
    if (pointValid) {
      await tx.insert(locations).values({
        applicationId: id,
        // With an agent, the device is theirs: it records where the agent met the customer.
        source: staff ? 'field_visit' : 'applicant',
        latitude: Number(Number(point.latitude).toFixed(6)),
        longitude: Number(Number(point.longitude).toFixed(6)),
        accuracyMeters: Number.isFinite(Number(point.accuracy)) ? Math.round(Number(point.accuracy)) : null,
        note: staff ? 'Captured by the agent when submitting' : null,
        capturedBy: staff?.id ?? null,
        capturedByName: staff?.name ?? null,
      })
    }
    await addEvent(tx, {
      applicationId: id,
      actor: staff,
      type: 'status',
      toStatus: 'submitted',
      message: staff ? `Submitted by ${staff.name} on the customer’s behalf` : 'Application submitted',
      visibleToCustomer: true,
    })
    return row
  })

  if (staff) await consumeOtp('consent', applicant.email)
  await deleteDraft(draftEmail, draft, token)
  await recordAudit({ req, actor: staff, action: 'application.submitted', entityType: 'application', entityId: application.id, detail: { reference: application.reference, channel: attribution.channel } })

  const origin = appOrigin(req)
  afterResponse('prescreen and LMS hand-off', async () => {
    await runPrescreen(application.id)
    const who = application.companyName || application.applicantName
    await notifyUsers(await creditStaffIds(), { type: 'new_application', title: `New application ${application.reference}`, body: `${who}, K${application.amount.toLocaleString()}`, applicationId: application.id }, { origin })
    if (application.assignedRm && application.assignedRm !== application.sourcedBy) {
      await notifyUsers([application.assignedRm], { type: 'team_application', title: `${staff?.name || 'Your agent'} brought in ${application.reference}`, body: who, applicationId: application.id }, { origin })
    }
    if (await queueLmsSyncIfDue(application, 'submit')) await syncApplicationToLms(application.id)
  })

  return { id: application.id, reference: application.reference }
}

// ---------------------------------------------------------------------------
// Staff views
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25
const SORTS = {
  newest: desc(applications.submittedAt),
  oldest: asc(applications.submittedAt),
  amount: desc(applications.amount),
  updated: desc(applications.updatedAt),
}

const listFilters = (viewer, query) => {
  const filters = [scopeApplications(viewer)]
  const status = query.get('status')
  if (status === 'open') filters.push(inArray(applications.status, OPEN_STATUSES))
  else if (status && APPLICATION_STATUSES[status]) filters.push(eq(applications.status, status))
  const loanType = query.get('loanType')
  if (loanType === 'personal' || loanType === 'business') filters.push(eq(applications.loanType, loanType))
  const channel = query.get('channel')
  // "self", or the role of whoever brought it in.
  if (channel && /^[a-z0-9_]{2,40}$/.test(channel)) filters.push(eq(applications.channel, channel))
  const assigned = query.get('assigned')
  if (assigned === 'me') filters.push(eq(applications.assignedOfficer, viewer.id))
  else if (assigned === 'unassigned') filters.push(isNull(applications.assignedOfficer))
  const lms = query.get('lms')
  if (lms) filters.push(eq(applications.lmsSyncStatus, lms))
  const sourcedBy = query.get('sourcedBy')
  if (sourcedBy && /^[0-9a-f-]{36}$/i.test(sourcedBy)) filters.push(eq(applications.sourcedBy, sourcedBy))
  const search = text(query.get('q'), 100)
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`
    filters.push(
      or(
        ilike(applications.reference, pattern),
        ilike(applications.applicantName, pattern),
        ilike(applications.applicantEmail, pattern),
        ilike(applications.companyName, pattern)
      )
    )
  }
  return filters.filter(Boolean)
}

const listApplications = async (req, res, { query }) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const page = Math.max(1, Number(query.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.get('pageSize')) || PAGE_SIZE))
  const filters = listFilters(viewer, query)
  const where = filters.length ? and(...filters) : undefined

  // Tab counts ignore the status filter so every tab shows its own total.
  const countQuery = new URLSearchParams(query)
  countQuery.delete('status')
  const countFilters = listFilters(viewer, countQuery)

  const [rows, [{ total }], statusCounts] = await Promise.all([
    db
      .select({
        application: applications,
        sourcedByName: sourcer.name,
        assignedOfficerName: officer.name,
        outcome: prescreens.outcome,
      })
      .from(applications)
      .leftJoin(sourcer, eq(sourcer.id, applications.sourcedBy))
      .leftJoin(officer, eq(officer.id, applications.assignedOfficer))
      .leftJoin(prescreens, eq(prescreens.applicationId, applications.id))
      .where(where)
      .orderBy(SORTS[query.get('sort')] || SORTS.newest)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql`count(*)::int` }).from(applications).where(where),
    db
      .select({ status: applications.status, count: sql`count(*)::int` })
      .from(applications)
      .where(countFilters.length ? and(...countFilters) : undefined)
      .groupBy(applications.status),
  ])

  return {
    applications: rows.map(({ application, sourcedByName, assignedOfficerName, outcome }) => {
      const { data, submissionKey, ...rest } = application
      return { ...rest, sourcedByName, assignedOfficerName, prescreenOutcome: outcome ?? null }
    }),
    total,
    page,
    pageSize,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.count])),
  }
}

/** Staff reads of personal data go in the audit log, at most once per person, case and half hour. */
const auditView = async (req, viewer, application) => {
  const key = `los:viewed:${viewer.id}:${application.id}`
  if (await kv.get(key)) return
  await kv.set(key, 1, { ex: 30 * 60 })
  await recordAudit({ req, actor: viewer, action: 'application.viewed', entityType: 'application', entityId: application.id, detail: { reference: application.reference } })
}

const publicDocument = ({ url, pathname, lmsFileUrl, ...document }) => ({ ...document, inLms: Boolean(lmsFileUrl) })

/** Everything the case page shows. Exported for the workflow handlers, which return it after each change. */
export const loadCase = async (applicationId) => {
  const db = await getDb()
  const [[row], documents, events, [prescreen], appraisalRows, consentRows, points, crbRows] = await Promise.all([
    db
      .select({ application: applications, sourcedByName: sourcer.name, sourcedByRole: sourcer.role, assignedOfficerName: officer.name, assignedRmName: rmUser.name })
      .from(applications)
      .leftJoin(sourcer, eq(sourcer.id, applications.sourcedBy))
      .leftJoin(officer, eq(officer.id, applications.assignedOfficer))
      .leftJoin(rmUser, eq(rmUser.id, applications.assignedRm))
      .where(eq(applications.id, applicationId)),
    db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId)).orderBy(asc(applicationDocuments.createdAt)),
    db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)).orderBy(desc(applicationEvents.id)),
    db.select().from(prescreens).where(eq(prescreens.applicationId, applicationId)).limit(1),
    db.select().from(appraisals).where(eq(appraisals.applicationId, applicationId)).orderBy(desc(appraisals.createdAt)),
    db.select().from(consents).where(eq(consents.applicationId, applicationId)),
    db.select().from(locations).where(eq(locations.applicationId, applicationId)).orderBy(asc(locations.capturedAt)),
    db.select().from(crbReports).where(eq(crbReports.applicationId, applicationId)).orderBy(desc(crbReports.createdAt)),
  ])
  const { submissionKey, ...application } = row.application
  return {
    application: {
      ...application,
      sourcedByName: row.sourcedByName,
      sourcedByRole: row.sourcedByRole,
      assignedOfficerName: row.assignedOfficerName,
      assignedRmName: row.assignedRmName,
    },
    documents: documents.map(publicDocument),
    events,
    prescreen: prescreen || null,
    appraisals: appraisalRows,
    consents: consentRows,
    locations: points,
    crbReports: crbRows,
    lmsConfigured: Boolean(await getLms()),
    offersRequireAcceptance: (await getSetting('offers')).requireAcceptance,
    stages: await getSetting('stages'),
    offersRequireSignature: (await getSetting('offers')).requireSignature,
    signatures: await signaturesOf(applicationId),
    crbProvider: getCrb()?.name || null,
  }
}

const getApplication = async (req, res, { params }) => {
  const viewer = await requireUser(req, { staff: true })
  const application = await findVisibleApplication(viewer, params.id)
  await auditView(req, viewer, application)
  // Approvals from before offer documents existed, or whose generation failed, get them now.
  if (APPROVED_STATUSES.includes(application.status)) await ensureOfferDocuments(application.id)
  return loadCase(application.id)
}

// Only these open inline; anything else downloads, so an uploaded HTML or SVG file can
// never run script on our origin.
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const sendFile = (res, { data, contentType, filename }) => {
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  const inline = INLINE_TYPES.has(type)
  const safeName = String(filename || 'document').replace(/["\\\r\n]/g, '')
  res.setHeader('Content-Type', inline ? type : 'application/octet-stream')
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`)
  res.setHeader('Content-Length', data.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.statusCode = 200
  res.end(data)
}

/** Streams one document to a viewer allowed the application. Staff and the customer alike. */
const getDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req)
  const application = await findVisibleApplication(viewer, params.id)
  const db = await getDb()
  const [document] = await db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.applicationId, application.id)))
    .limit(1)
  if (!document) fail(404, 'Document not found.', 'not_found')
  // Customers get what their own page lists (myApplication), not every file on the case.
  if (!isStaffRole(viewer.role) && document.source === 'system' && !(await customerOfferDocuments(application)).some((offer) => offer.id === document.id)) {
    fail(404, 'Document not found.', 'not_found')
  }
  const stored = await readBlob(document)
  if (!stored) fail(410, 'This file is no longer in storage.', 'gone')
  if (isStaffRole(viewer.role)) {
    await recordAudit({ req, actor: viewer, action: 'application.document_viewed', entityType: 'application', entityId: application.id, detail: { document: document.label } })
  }
  sendFile(res, { data: stored.data, contentType: document.contentType || stored.contentType, filename: document.filename })
}

// ---------------------------------------------------------------------------
// LMS actions (loan officer / admin)
// ---------------------------------------------------------------------------

/** Send now: from waiting (not yet due), pending, or a clear failure. */
const sendToLms = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'cases.disburse' })
  const application = await findVisibleApplication(viewer, params.id)
  if (!(await getLms())) fail(400, 'No LMS is connected to this workspace.', 'lms_not_configured')
  if (!['waiting', 'pending', 'failed'].includes(application.lmsSyncStatus)) {
    fail(409, application.lmsSyncStatus === 'uncertain' ? 'Check the LMS and reconcile this case first.' : 'This case is already in the LMS or on its way.', 'lms_state')
  }
  const db = await getDb()
  await db.update(applications).set({ lmsSyncStatus: 'pending' }).where(eq(applications.id, application.id))
  await recordAudit({ req, actor: viewer, action: 'application.lms_send', entityType: 'application', entityId: application.id })
  await syncApplicationToLms(application.id, { actor: viewer })
  return loadCase(application.id)
}

/**
 * Settles an `uncertain` hand-off after someone has checked the LMS:
 *   { found: true, reference }   it is there — record its reference
 *   { found: false }             it is not — allow sending again
 */
const reconcileLms = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'cases.disburse' })
  const application = await findVisibleApplication(viewer, params.id)
  if (application.lmsSyncStatus !== 'uncertain') fail(409, 'Only an unconfirmed hand-off needs reconciling.', 'lms_state')
  const db = await getDb()
  const found = Boolean(req.body?.found)
  const reference = text(req.body?.reference, 100)
  if (found && !reference) fail(400, 'Enter the loan reference from the LMS.', 'invalid_input')
  await db
    .update(applications)
    .set(found ? { lmsSyncStatus: 'synced', lmsReference: reference, lmsSyncedAt: new Date(), lmsError: null } : { lmsSyncStatus: 'failed', lmsError: 'Confirmed not in the LMS; ready to send again.' })
    .where(eq(applications.id, application.id))
  await addEvent(db, {
    applicationId: application.id,
    actor: viewer,
    type: 'lms',
    message: found ? `Confirmed in the LMS as ${reference}` : 'Confirmed not in the LMS',
  })
  await recordAudit({ req, actor: viewer, action: 'application.lms_reconciled', entityType: 'application', entityId: application.id, detail: { found, reference: reference || null } })
  return loadCase(application.id)
}

// ---------------------------------------------------------------------------
// Customer views
// ---------------------------------------------------------------------------

const customerSummary = (application) => {
  const status = APPLICATION_STATUSES[application.status] || {}
  return {
    id: application.id,
    reference: application.reference,
    loanType: application.loanType,
    amount: application.amount,
    tenure: application.tenure,
    totalRepayable: application.totalRepayable,
    monthlyInstalment: application.monthlyInstalment,
    status: application.status,
    statusLabel: status.customer,
    statusDetail: application.status === 'approved' && application.offerExpiresAt ? 'Review and accept your offer to go ahead.' : status.customerDetail,
    submittedAt: application.submittedAt,
    decidedAt: application.decidedAt,
    infoRequest: application.status === 'info_requested' ? application.infoRequest : null,
    // The offer, while one is waiting for them.
    offer:
      application.status === 'approved' && application.offerExpiresAt
        ? {
            amount: application.approvedAmount ?? application.amount,
            tenure: application.approvedTenure ?? application.tenure,
            monthlyInstalment: application.monthlyInstalment,
            totalRepayable: application.totalRepayable,
            expiresAt: application.offerExpiresAt,
          }
        : null,
    canWithdraw: WITHDRAWABLE_STATUSES.includes(application.status),
  }
}

/** Applications the LMS holds for this email that did not come through this portal (read-only). */
const legacyLmsApplications = async (email, knownReferences) => {
  const lms = await getLms()
  if (!lms) return []
  try {
    const rows = await lms.listByEmail(email)
    return rows
      .filter((row) => !knownReferences.has(row.name))
      .map((row) => ({
        reference: row.name,
        loanType: String(row.application_type || '').toLowerCase().includes('business') ? 'business' : 'personal',
        amount: Number(row.amount) || null,
        tenure: Number(row.tenure) || null,
        status: row.loan_application_status || row.status || 'Submitted',
        submittedAt: row.application_date || row.creation || null,
      }))
  } catch (error) {
    console.warn(`[lms] could not list legacy applications: ${error?.message}`)
    return []
  }
}

const myApplications = async (req) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const db = await getDb()
  const rows = await db.select().from(applications).where(scopeApplications(viewer)).orderBy(desc(applications.submittedAt))
  const known = new Set(rows.map((row) => row.lmsReference).filter(Boolean))
  return { applications: rows.map(customerSummary), earlier: await legacyLmsApplications(viewer.email, known) }
}

/**
 * The offer letter and agreement the customer sees: offer letter first, then the
 * agreement, each the signed copy once there is one. Made now if the approval didn't
 * manage to. Other system files (earlier versions) stay staff-only.
 */
const customerOfferDocuments = async (application) => {
  const offerDocs = APPROVED_STATUSES.includes(application.status) ? await ensureOfferDocuments(application.id) : {}
  return TEMPLATE_KIND_KEYS.filter((kind) => offerDocs[kind]).map((kind) => [kind, offerDocs[kind]]).flatMap(([kind, versions]) =>
    [versions.signed, versions.unsigned].filter(Boolean).slice(0, 1).map((row) => ({ id: row.id, kind, label: row.label, signed: Boolean(row.meta.signed) }))
  )
}

const myApplication = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  const db = await getDb()
  const [events, documents] = await Promise.all([
    db
      .select({ id: applicationEvents.id, at: applicationEvents.at, type: applicationEvents.type, toStatus: applicationEvents.toStatus, message: applicationEvents.message, detail: applicationEvents.detail })
      .from(applicationEvents)
      .where(and(eq(applicationEvents.applicationId, application.id), eq(applicationEvents.visibleToCustomer, true)))
      .orderBy(desc(applicationEvents.id))
      // Staff wording (e.g. a decline rationale) is replaced by its customer copy where one exists.
      .then((rows) => rows.map(({ detail, ...event }) => ({ ...event, message: detail?.customerMessage || event.message }))),
    db
      .select({ id: applicationDocuments.id, label: applicationDocuments.label, filename: applicationDocuments.filename, createdAt: applicationDocuments.createdAt, source: applicationDocuments.source, meta: applicationDocuments.meta })
      .from(applicationDocuments)
      .where(eq(applicationDocuments.applicationId, application.id))
      .orderBy(asc(applicationDocuments.createdAt)),
  ])
  const offerDocuments = await customerOfferDocuments(application)
  // Conditions the approver attached to the offer, shown with it.
  const [decision] = await db
    .select({ conditions: appraisals.conditions })
    .from(appraisals)
    .where(and(eq(appraisals.applicationId, application.id), eq(appraisals.verdict, 'approve')))
    .orderBy(desc(appraisals.createdAt))
    .limit(1)
  const summary = customerSummary(application)
  if (summary.offer) {
    summary.offer.conditions = decision?.conditions || null
    summary.offer.requireSignature = (await getSetting('offers')).requireSignature
  }
  return { application: summary, events, documents: documents.filter((document) => document.source !== 'system').map(({ meta, ...document }) => document), offerDocuments }
}

// ---------------------------------------------------------------------------
// Prefill and draft files (public / draft-token)
// ---------------------------------------------------------------------------

const EMPTY_LOAN = { amount: 4000, tenure: 6 }

/**
 * Form values from the applicant's most recent application of this type — from this
 * portal first, then the LMS. Unauthenticated by the product owner's decision; files are
 * never included and must be attached again.
 */
const prefill = async (req, res, { query }) => {
  const email = parseEmail(query.get('email'))
  const loanType = query.get('type')
  if (!email || !['personal', 'business'].includes(loanType)) fail(400, 'Email and loan type are required.', 'invalid_input')
  const db = await getDb()
  const [latest] = await db
    .select({ data: applications.data })
    .from(applications)
    .where(and(eq(applications.applicantEmail, email), eq(applications.loanType, loanType)))
    .orderBy(desc(applications.submittedAt))
    .limit(1)

  if (latest) {
    const blank = mapApplicationToFormState({}, loanType)
    const data = stripAttachments(latest.data)
    return {
      formState: {
        loanData: EMPTY_LOAN,
        personalData: loanType === 'personal' ? data : blank.personalData,
        businessData: loanType === 'business' ? data : blank.businessData,
      },
    }
  }

  const lms = await getLms()
  if (!lms) return { formState: null }
  try {
    const found = selectLatestApplication(await lms.listByEmail(email), loanType)
    return { formState: found ? mapApplicationToFormState(found, loanType) : null }
  } catch (error) {
    console.warn(`[prefill] LMS lookup failed: ${error?.message}`)
    return { formState: null }
  }
}

/** A file from the caller's own draft, for resuming on another device (works with a private store). */
const draftFile = async (req, res, { query }) => {
  const email = await draftEmailFor(bearer(req))
  if (!email) fail(401, 'Missing or invalid draft token.', 'invalid_token')
  const draft = await kv.get(`draft:${email}`)
  const ref = draft?.documents?.[query.get('path')]
  if (!ref) fail(404, 'File not found in this draft.', 'not_found')
  const stored = await readBlob(ref)
  if (!stored) fail(410, 'This file is no longer in storage.', 'gone')
  sendFile(res, { data: stored.data, contentType: ref.contentType || stored.contentType, filename: ref.filename })
}

/** Public: the products applicants can choose, with current pricing. */
const listProducts = async () => ({ products: (await getProducts()).filter((product) => product.enabled) })

export const applicationRoutes = [
  ['GET', '/products', listProducts],
  ['POST', '/applications', submitApplication],
  ['GET', '/applications', listApplications],
  ['GET', '/applications/:id', getApplication],
  ['GET', '/applications/:id/documents/:documentId', getDocument],
  ['POST', '/applications/:id/lms/send', sendToLms],
  ['POST', '/applications/:id/lms/reconcile', reconcileLms],
  ['GET', '/me/applications', myApplications],
  ['GET', '/me/applications/:id', myApplication],
  ['GET', '/prefill', prefill],
  ['GET', '/drafts/file', draftFile],
]
