import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { appOrigin, clientIp as clientIpOf, fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { putBlob } from '../_lib/blob.js'
import { readSingleUpload } from '../_lib/upload.js'
import { afterResponse } from '../_lib/after.js'
import { sendApplicationUpdateEmail } from '../_lib/email.js'
import { addEvent, findVisibleApplication } from '../_lib/applications.js'
import { applyAction, CREDIT_ROLES } from '../_lib/workflow.js'
import { queueLmsSyncIfDue, syncApplicationToLms } from '../_lib/lms/sync.js'
import { runPrescreen, loadFactInputs } from '../_lib/prescreen/run.js'
import { computeFacts } from '../_lib/prescreen/facts.js'
import { getDraftRuleset, getPublishedRuleset, listRulesetHistory, publishDraftRuleset, saveDraftRuleset } from '../_lib/prescreen/rulesets.js'
import { getSetting } from '../_lib/settings.js'
import { CrbError, getCrb } from '../_lib/crb/index.js'
import { identityFor } from '../_lib/crb/identity.js'
import kv from '../_lib/kv.js'
import { reportError } from '../_lib/errors.js'
import { loadCase } from './applications.js'
import { consumeOtp } from '../_lib/otp.js'
import { creditStaffIds, followerIds, notifyUsers } from '../_lib/notify.js'
import { textCustomer } from '../_lib/sms.js'
import { WITHDRAWABLE_STATUSES } from '../../src/config/applications.js'
import { FACTS, evaluateRules, validateRules } from '../../src/config/creditRules.js'

const { applications, applicationDocuments, prescreens, users, locations, crbReports, consents } = schema

// ---------------------------------------------------------------------------
// Case actions
// ---------------------------------------------------------------------------

const notifyCustomer = (req, application, notify) =>
  afterResponse('customer email', async () => {
    await sendApplicationUpdateEmail(application.applicantEmail, {
      reference: application.reference,
      headline: notify.headline,
      body: notify.body,
      url: `${appOrigin(req)}/my-applications`,
    })
    // A short text too, where an SMS provider is set up and customer texts are on.
    await textCustomer(application.applicantPhone, `${notify.headline} (${application.reference}). Details: ${appOrigin(req)}/my-applications`)
  })

/** Tells the right staff what an action means for them. */
const notifyStaffAbout = (req, viewer, action, input, application) =>
  afterResponse('staff notifications', async () => {
    const origin = appOrigin(req)
    const base = { applicationId: application.id }
    const who = application.companyName || application.applicantName
    if (action === 'assign' && application.assignedOfficer && application.assignedOfficer !== viewer.id) {
      await notifyUsers([application.assignedOfficer], { ...base, type: 'assigned', title: `${application.reference} was assigned to you`, body: `${who}, by ${viewer.name}` }, { origin })
    }
    if (action === 'recommend' && application.status === 'pending_approval') {
      await notifyUsers(await creditStaffIds({ except: viewer.id }), { ...base, type: 'awaiting_decision', title: `${application.reference} is waiting for a decision`, body: `${viewer.name} recommended it. ${who}` }, { origin })
    }
    if ((action === 'decide' || action === 'recommend') && ['approved', 'declined'].includes(application.status)) {
      const outcome = application.status === 'approved' ? 'approved' : 'declined'
      await notifyUsers(followerIds(application).filter((id) => id !== viewer.id), { ...base, type: 'decided', title: `${application.reference} was ${outcome}`, body: who }, { origin })
    }
    if (action === 'record_acceptance') {
      await notifyUsers(followerIds(application).filter((id) => id !== viewer.id), { ...base, type: 'offer_accepted', title: `${application.reference}: offer accepted`, body: `${who}. Ready for payout.` }, { origin })
    }
  })

const act = async (req, res, { params }) => {
  const viewer = await requireUser(req, { staff: true })
  const application = await findVisibleApplication(viewer, params.id)
  const input = req.body || {}
  const { application: updated, result } = await applyAction(viewer, application.id, input)
  await recordAudit({ req, actor: viewer, action: `application.${input.action}`, entityType: 'application', entityId: application.id, detail: { reference: application.reference, status: updated.status } })

  if (result.consumeOtpFor) await consumeOtp(result.consumeOtpFor)
  notifyStaffAbout(req, viewer, input.action, input, updated)
  if (result.notify) notifyCustomer(req, updated, result.notify)
  // An approval reaches the LMS straight away unless the customer must accept it first.
  const { requireAcceptance } = await getSetting('offers')
  const handOff = result.accepted || (result.approved && !requireAcceptance)
  if (handOff && (await queueLmsSyncIfDue(updated, 'approval'))) {
    afterResponse('LMS hand-off', () => syncApplicationToLms(updated.id, { actor: viewer }))
  }
  return loadCase(application.id, viewer)
}

/** Credit staff for the "assign to" picker. */
const listOfficers = async (req) => {
  await requireUser(req, { staff: true })
  const db = await getDb()
  const officers = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, CREDIT_ROLES), eq(users.status, 'active')))
    .orderBy(asc(users.name))
  return { officers }
}

/** Staff add a document to a case (collected in person, or a better copy). */
const addStaffDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req, { staff: true })
  const application = await findVisibleApplication(viewer, params.id)
  const { fields, file } = await readSingleUpload(req)
  const label = text(fields.label, 120) || file.filename
  const db = await getDb()
  const stored = await putBlob(`applications/${application.id}/extra-${file.filename}`, file.data, { contentType: file.contentType })
  await db.insert(applicationDocuments).values({
    applicationId: application.id,
    slot: `extra.${Date.now()}`,
    docType: 'other',
    label,
    pathname: stored.pathname,
    url: stored.url,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    source: 'staff',
    uploadedBy: viewer.id,
  })
  await addEvent(db, { applicationId: application.id, actor: viewer, type: 'document', message: `Added a document: ${label}` })
  await recordAudit({ req, actor: viewer, action: 'application.document_added', entityType: 'application', entityId: application.id, detail: { label } })
  return loadCase(application.id, viewer)
}

const rerunPrescreen = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: CREDIT_ROLES })
  const application = await findVisibleApplication(viewer, params.id)
  await runPrescreen(application.id, { actor: viewer })
  await recordAudit({ req, actor: viewer, action: 'application.prescreen_rerun', entityType: 'application', entityId: application.id })
  return loadCase(application.id, viewer)
}

/** A field visit: where the staff member is now, with a note. Needs their device's location. */
const logVisit = async (req, res, { params }) => {
  const viewer = await requireUser(req, { staff: true })
  const application = await findVisibleApplication(viewer, params.id)
  const latitude = Number(req.body?.latitude)
  const longitude = Number(req.body?.longitude)
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    fail(400, 'Your device did not provide a location.', 'invalid_location')
  }
  const accuracy = Number(req.body?.accuracy)
  const note = text(req.body?.note, 500)
  const db = await getDb()
  await db.insert(locations).values({
    applicationId: application.id,
    source: 'field_visit',
    latitude,
    longitude,
    accuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    note: note || null,
    capturedBy: viewer.id,
    capturedByName: viewer.name,
  })
  await addEvent(db, { applicationId: application.id, actor: viewer, type: 'visit', message: note ? `Field visit: ${note}` : 'Field visit logged' })
  await recordAudit({ req, actor: viewer, action: 'application.visit_logged', entityType: 'application', entityId: application.id })
  return loadCase(application.id, viewer)
}

// Long enough to cover the bureau's timeout plus loading its WSDL.
const CRB_LOCK_SECONDS = 180
// Our own setup, not the bureau, is at fault for these.
const CRB_SETUP_CODES = new Set(['crb_not_configured', 'crb_contract_mismatch', 'crb_insecure_url'])

const crbEventMessage = (crb, score, report, unchanged) => {
  if (crb.sample) return `Credit bureau score ${score} (sample data)`
  const headline = report.found === false
    ? `Credit bureau: no report for this NRC${report.responseCode === null || report.responseCode === undefined ? '' : ` (response code ${report.responseCode})`}`
    :`Credit bureau score ${score ?? 'not given'}${report.grade ? `, grade ${report.grade}` : ''}`
  const notes = [
    report.testIdentity && `bureau test identity ${report.testIdentity.nrc}, not the applicant`,
    unchanged && 'unchanged since the previous report',
    report.identity?.mismatch && 'the bureau returned a different NRC — check before relying on it',
  ]
  return [headline, ...notes.filter(Boolean)].join('; ')
}

/**
 * Pulls a credit bureau report, only with the applicant's recorded consent, for the
 * person the application is about. Staff wait for the answer (at most the bureau's
 * timeout); each pull is kept, so the case shows every enquiry made.
 */
const runCreditCheck = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: CREDIT_ROLES })
  const application = await findVisibleApplication(viewer, params.id)
  const crb = getCrb()
  if (!crb) fail(400, 'No credit bureau is connected.', 'crb_not_configured')
  const db = await getDb()
  const [consent] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.applicationId, application.id), eq(consents.type, 'crb'), eq(consents.granted, true)))
    .limit(1)
  if (!consent) fail(403, 'The applicant has not consented to a credit bureau check.', 'no_consent')
  const identity = identityFor(application)

  // One pull at a time per case: a double click, or two officers at once, would
  // otherwise make two enquiries at the bureau.
  const lockKey = `los:crb-pull:${application.id}`
  if ((await kv.set(lockKey, viewer.id, { nx: true, ex: CRB_LOCK_SECONDS })) === null) {
    fail(409, 'A credit report is already being pulled for this application. Try again in a moment.', 'crb_in_progress')
  }
  let pulled
  try {
    pulled = await crb.fetchReport(identity)
  } catch (error) {
    if (!(error instanceof CrbError)) throw error
    // Only our own wording is recorded: the bureau's reply may echo the applicant's details.
    const message = error.uncertain ? `${error.message} It may still have recorded the enquiry.` : error.message
    await addEvent(db, { applicationId: application.id, actor: viewer, type: 'crb', message: `Credit bureau check failed: ${message}` })
    await recordAudit({ req, actor: viewer, action: 'application.crb_failed', entityType: 'application', entityId: application.id, detail: { provider: crb.name, code: error.code, uncertain: error.uncertain } })
    await reportError({ source: 'crb', message: `${error.code}: ${error.message}`, route: 'POST /applications/:id/crb', detail: { provider: crb.name } })
    fail(CRB_SETUP_CODES.has(error.code) ? 503 : 502, message, error.code)
  } finally {
    await kv.del(lockKey)
  }

  const { score, report } = pulled
  const [previous] = await db
    .select({ report: crbReports.report })
    .from(crbReports)
    .where(eq(crbReports.applicationId, application.id))
    .orderBy(desc(crbReports.createdAt))
    .limit(1)
  const unchanged = Boolean(report.fingerprint) && previous?.report?.fingerprint === report.fingerprint
  await db.transaction(async (tx) => {
    await tx.insert(crbReports).values({ applicationId: application.id, provider: crb.name, score, report, requestedBy: viewer.id })
    await addEvent(tx, { applicationId: application.id, actor: viewer, type: 'crb', message: crbEventMessage(crb, score, report, unchanged) })
  })
  await recordAudit({
    req,
    actor: viewer,
    action: 'application.crb_checked',
    entityType: 'application',
    entityId: application.id,
    detail: { provider: crb.name, ...(report.requestNo ? { bureauRequest: report.requestNo } : {}), ...(report.identity?.mismatch ? { identityMismatch: true } : {}) },
  })
  // The score is a rule input, so the prescreen is brought up to date.
  await runPrescreen(application.id, { actor: viewer })
  return loadCase(application.id, viewer)
}

// ---------------------------------------------------------------------------
// Customer: answering an information request
// ---------------------------------------------------------------------------

const assertAwaitingCustomer = (application) => {
  if (application.status !== 'info_requested') fail(409, 'We are not waiting for anything from you on this application.', 'invalid_state')
}

const addCustomerDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  assertAwaitingCustomer(application)
  const { fields, file } = await readSingleUpload(req)
  const label = text(fields.label, 120) || file.filename
  const db = await getDb()
  const stored = await putBlob(`applications/${application.id}/response-${file.filename}`, file.data, { contentType: file.contentType })
  const [document] = await db
    .insert(applicationDocuments)
    .values({
      applicationId: application.id,
      slot: `response.${Date.now()}`,
      docType: 'other',
      label,
      pathname: stored.pathname,
      url: stored.url,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      source: 'info_response',
      uploadedBy: viewer.id,
    })
    .returning({ id: applicationDocuments.id, label: applicationDocuments.label, filename: applicationDocuments.filename })
  return { document }
}

const respondToRequest = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  assertAwaitingCustomer(application)
  const message = text(req.body?.message, 2000)
  const db = await getDb()
  const [responses] = await db
    .select({ id: applicationDocuments.id })
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.applicationId, application.id), eq(applicationDocuments.source, 'info_response')))
    .orderBy(desc(applicationDocuments.createdAt))
    .limit(1)
  if (!message && !responses) fail(400, 'Write a reply or attach a document.', 'invalid_input')

  const nextStatus = application.assignedOfficer ? 'in_review' : 'submitted'
  await db.transaction(async (tx) => {
    await tx
      .update(applications)
      .set({ status: nextStatus, infoRequest: null, version: application.version + 1, updatedAt: new Date() })
      .where(eq(applications.id, application.id))
    await addEvent(tx, {
      applicationId: application.id,
      actor: viewer,
      type: 'info_response',
      fromStatus: 'info_requested',
      toStatus: nextStatus,
      message: message || 'Sent the requested documents',
      visibleToCustomer: true,
    })
  })
  await recordAudit({ req, actor: viewer, action: 'application.info_response', entityType: 'application', entityId: application.id })
  const recipients = application.assignedOfficer ? [application.assignedOfficer] : await creditStaffIds()
  afterResponse('staff notifications', () =>
    notifyUsers(recipients, { type: 'customer_replied', title: `The applicant replied on ${application.reference}`, body: message || 'They sent the requested documents.', applicationId: application.id }, { origin: appOrigin(req) })
  )
  // New documents may change the facts the rules see.
  afterResponse('prescreen after response', () => runPrescreen(application.id))
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Customer: the offer, and withdrawing
// ---------------------------------------------------------------------------

const offerTerms = (application) => `offer:K${application.approvedAmount ?? application.amount}x${application.approvedTenure ?? application.tenure}m:total K${application.totalRepayable}`

/** The customer accepts the approved offer. Records the exact terms agreed to. */
const acceptOffer = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  if (application.status !== 'approved') fail(409, 'There is no offer waiting for you on this application.', 'invalid_state')
  if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired. You are welcome to apply again.', 'offer_expired')
  const db = await getDb()
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(applications)
      .set({ status: 'accepted', acceptedAt: new Date(), version: application.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.status, 'approved')))
      .returning()
    if (!updated) fail(409, 'This offer changed. Refresh the page.', 'stale')
    await tx.insert(consents).values({ applicationId: application.id, type: 'offer', granted: true, noticeVersion: offerTerms(application), method: 'applicant_checkbox', capturedBy: viewer.id, ip: clientIpOf(req) })
    await addEvent(tx, { applicationId: application.id, actor: viewer, type: 'status', fromStatus: 'approved', toStatus: 'accepted', message: 'Offer accepted', visibleToCustomer: true })
  })
  await recordAudit({ req, actor: viewer, action: 'application.offer_accepted', entityType: 'application', entityId: application.id, detail: { reference: application.reference } })
  afterResponse('staff notifications', async () =>
    notifyUsers(followerIds(application).length ? followerIds(application) : await creditStaffIds(), { type: 'offer_accepted', title: `${application.reference}: offer accepted`, body: 'Ready for payout.', applicationId: application.id }, { origin: appOrigin(req) })
  )
  const [fresh] = await db.select().from(applications).where(eq(applications.id, application.id))
  if (await queueLmsSyncIfDue(fresh, 'approval')) afterResponse('LMS hand-off', () => syncApplicationToLms(fresh.id))
  return { ok: true }
}

/** The customer withdraws (including turning down an offer). */
const withdrawApplication = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  if (!WITHDRAWABLE_STATUSES.includes(application.status)) fail(409, 'This application can no longer be withdrawn.', 'invalid_state')
  const why = text(req.body?.reason, 500) || (application.status === 'approved' ? 'Turned down the offer' : 'Withdrawn by the applicant')
  const db = await getDb()
  await db.transaction(async (tx) => {
    await tx
      .update(applications)
      .set({ status: 'withdrawn', withdrawnAt: new Date(), closedReason: why, version: application.version + 1, updatedAt: new Date() })
      .where(eq(applications.id, application.id))
    await addEvent(tx, {
      applicationId: application.id,
      actor: viewer,
      type: 'status',
      fromStatus: application.status,
      toStatus: 'withdrawn',
      message: application.status === 'approved' ? `Offer turned down: ${why}` : `Withdrawn: ${why}`,
      visibleToCustomer: true,
    })
  })
  await recordAudit({ req, actor: viewer, action: 'application.withdrawn', entityType: 'application', entityId: application.id, detail: { reference: application.reference } })
  return { ok: true }
}

/** Cron: offers not accepted in time lapse, and the customer is told. */
export const expireOffers = async (origin) => {
  const db = await getDb()
  const lapsed = await db
    .update(applications)
    .set({ status: 'expired', closedReason: 'Offer not accepted in time', updatedAt: new Date() })
    .where(and(eq(applications.status, 'approved'), lt(applications.offerExpiresAt, new Date())))
    .returning()
  for (const application of lapsed) {
    await addEvent(db, { applicationId: application.id, actor: null, type: 'status', fromStatus: 'approved', toStatus: 'expired', message: 'The offer expired before it was accepted', visibleToCustomer: true })
    await sendApplicationUpdateEmail(application.applicantEmail, {
      reference: application.reference,
      headline: 'Your loan offer has expired',
      body: 'The loan offer on your application was not accepted in time, so it has lapsed. You are welcome to apply again.',
      url: `${origin}/my-applications`,
    }).catch(() => {})
  }
  return lapsed.length
}

// ---------------------------------------------------------------------------
// Credit rules and settings (admin; officers may read the rules)
// ---------------------------------------------------------------------------

const getRules = async (req) => {
  await requireUser(req, { roles: ['admin', 'loan_officer', 'sales_manager'] })
  const [published, draft, history] = await Promise.all([getPublishedRuleset(), getDraftRuleset(), listRulesetHistory()])
  return { published, draft, history, facts: FACTS }
}

const saveDraft = async (req) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  let rules
  try {
    rules = validateRules(req.body?.rules)
  } catch (error) {
    fail(400, error.message, 'invalid_rules')
  }
  const draft = await saveDraftRuleset(rules, text(req.body?.note, 300) || null, actor)
  await recordAudit({ req, actor, action: 'rules.draft_saved', entityType: 'ruleset', entityId: draft.id, detail: { rules: rules.length } })
  return { draft }
}

const discardDraft = async (req) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  const draft = await getDraftRuleset()
  if (draft) {
    const db = await getDb()
    await db.delete(schema.rulesets).where(eq(schema.rulesets.id, draft.id))
    await recordAudit({ req, actor, action: 'rules.draft_discarded', entityType: 'ruleset', entityId: draft.id })
  }
  return { ok: true }
}

const SIMULATION_SAMPLE = 300

/**
 * Replays recent applications' stored facts through proposed rules, so an admin sees how
 * outcomes would change before publishing. Uses the facts recorded at prescreen time.
 */
const simulate = async (req) => {
  await requireUser(req, { roles: ['admin'] })
  let rules
  try {
    rules = validateRules(req.body?.rules)
  } catch (error) {
    fail(400, error.message, 'invalid_rules')
  }
  const db = await getDb()
  const rows = await db
    .select({ id: applications.id, reference: applications.reference, applicantName: applications.applicantName, loanType: applications.loanType, facts: prescreens.facts, outcome: prescreens.outcome })
    .from(prescreens)
    .innerJoin(applications, eq(applications.id, prescreens.applicationId))
    .orderBy(desc(applications.submittedAt))
    .limit(SIMULATION_SAMPLE)

  const tally = () => ({ pass: 0, refer: 0, decline: 0 })
  const current = tally()
  const proposed = tally()
  const changed = []
  const firing = {}
  rows.forEach((row) => {
    const next = evaluateRules(rules, row.facts, row.loanType)
    current[row.outcome] += 1
    proposed[next.outcome] += 1
    next.results.filter((result) => result.state === 'fired').forEach((result) => {
      firing[result.id] = (firing[result.id] || 0) + 1
    })
    if (next.outcome !== row.outcome) changed.push({ id: row.id, reference: row.reference, applicantName: row.applicantName, from: row.outcome, to: next.outcome })
  })
  return { sample: rows.length, current, proposed, changed: changed.slice(0, 50), changedCount: changed.length, firing }
}

const publish = async (req) => {
  const actor = await requireUser(req, { roles: ['admin'] })
  const published = await publishDraftRuleset(actor, text(req.body?.note, 300) || null)
  if (!published) fail(400, 'There is no draft to publish.', 'no_draft')
  await recordAudit({ req, actor, action: 'rules.published', entityType: 'ruleset', entityId: published.id, detail: { version: published.version } })
  return { published }
}

/** Facts for an application, recomputed now — for the "why" panel when no prescreen exists yet. */
const previewFacts = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: CREDIT_ROLES })
  const application = await findVisibleApplication(viewer, params.id)
  const { documents, points, crb } = await loadFactInputs(application.id)
  return { facts: computeFacts(application, documents, { locations: points, crbScore: crb?.score ?? null }) }
}

export const workflowRoutes = [
  ['POST', '/applications/:id/actions', act],
  ['POST', '/applications/:id/documents', addStaffDocument],
  ['POST', '/applications/:id/prescreen', rerunPrescreen],
  ['GET', '/applications/:id/facts', previewFacts],
  ['POST', '/applications/:id/visits', logVisit],
  ['POST', '/applications/:id/crb', runCreditCheck],
  ['GET', '/officers', listOfficers],
  ['POST', '/me/applications/:id/documents', addCustomerDocument],
  ['POST', '/me/applications/:id/respond', respondToRequest],
  ['POST', '/me/applications/:id/accept', acceptOffer],
  ['POST', '/me/applications/:id/withdraw', withdrawApplication],
  ['GET', '/rules', getRules],
  ['PUT', '/rules/draft', saveDraft],
  ['DELETE', '/rules/draft', discardDraft],
  ['POST', '/rules/simulate', simulate],
  ['POST', '/rules/publish', publish],
]

