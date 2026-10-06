import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { appOrigin, clientIp as clientIpOf, fail, text } from '../_lib/http.js'
import { requirePermission, requireUser } from '../_lib/rbac.js'
import { discardSignature, parseSignature, signOfferDocuments } from '../_lib/signing.js'
import { recordAudit } from '../_lib/audit.js'
import { putBlob } from '../_lib/blob.js'
import { readSingleUpload } from '../_lib/upload.js'
import { afterResponse } from '../_lib/after.js'
import { sendApplicationUpdateEmail } from '../_lib/email.js'
import { addEvent, findVisibleApplication } from '../_lib/applications.js'
import { applyAction, caseWorkflow, systemTransition } from '../_lib/workflow.js'
import { rolesWith } from '../_lib/roles.js'
import { queueLmsSync, syncApplicationToLms } from '../_lib/lms/sync.js'
import { runPrescreen, loadFactInputs } from '../_lib/prescreen/run.js'
import { computeFacts } from '../_lib/prescreen/facts.js'
import { getDraftRuleset, getPublishedRuleset, listRulesetHistory, publishDraftRuleset, saveDraftRuleset } from '../_lib/prescreen/rulesets.js'
import { getSetting } from '../_lib/settings.js'
import { CrbError, getCrb } from '../_lib/crb/index.js'
import { identityFor } from '../_lib/crb/identity.js'
import kv from '../_lib/kv.js'
import { reportError } from '../_lib/errors.js'
import { loadCase } from './applications.js'
import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { creditStaffIds, followerIds, notifyUsers } from '../_lib/notify.js'
import { textCustomer } from '../_lib/sms.js'
import { WITHDRAWABLE_STATUSES } from '../../src/config/applications.js'
import { ensureOfferDocuments } from '../_lib/offerDocuments.js'
import { issueStageDocuments } from '../_lib/stageDocuments.js'
import { FACTS, evaluateRules, flattenPolicies, rulesToPolicies, validatePolicies } from '../../src/config/creditRules.js'

const { applications, applicationDocuments, prescreens, users, locations, crbReports, consents } = schema

// ---------------------------------------------------------------------------
// Case actions
// ---------------------------------------------------------------------------

/** Hands a case to the LMS in the background, once it has entered a state marked for it. */
const handToLms = async (application, actor = null) => {
  if (await queueLmsSync(application)) afterResponse('LMS hand-off', () => syncApplicationToLms(application.id, actor ? { actor } : undefined))
}

/** Makes and emails the documents the case's new state sends the applicant, if it sends any (stageDocuments.js). */
const sendStageDocuments = (req, application, actor = null) =>
  afterResponse('stage documents', () => issueStageDocuments(application.id, { origin: appOrigin(req), actor, req }))

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

/** Tells the right staff what an action means for them, by what it did rather than what it was called. */
const notifyStaffAbout = (req, viewer, action, result, application) =>
  afterResponse('staff notifications', async () => {
    const origin = appOrigin(req)
    const base = { applicationId: application.id }
    const who = application.companyName || application.applicantName
    if (action === 'assign' && application.assignedOfficer && application.assignedOfficer !== viewer.id) {
      await notifyUsers([application.assignedOfficer], { ...base, type: 'assigned', title: `${application.reference} was assigned to you`, body: `${who}, by ${viewer.name}` }, { origin })
    }
    if (result.recommended && application.status === 'pending_approval') {
      await notifyUsers(await creditStaffIds({ except: viewer.id, permission: 'cases.decide' }), { ...base, type: 'awaiting_decision', title: `${application.reference} is waiting for a decision`, body: `${viewer.name} recommended it. ${who}` }, { origin })
    }
    if (result.decided) {
      await notifyUsers(followerIds(application).filter((id) => id !== viewer.id), { ...base, type: 'decided', title: `${application.reference} was ${result.decided}`, body: who }, { origin })
    }
    if (result.accepted) {
      await notifyUsers(followerIds(application).filter((id) => id !== viewer.id), { ...base, type: 'offer_accepted', title: `${application.reference}: offer accepted`, body: `${who}. Ready for payout.` }, { origin })
    }
  })

/**
 * In-person acceptance with signing on: the customer signs on the staff member's device
 * and reads back their emailed code. The documents are signed first, outside the
 * acceptance's transaction; if the acceptance then fails, the signed copies are removed.
 */
const signInPerson = async (req, viewer, application, input) => {
  requirePermission(viewer, 'offers.record', 'Your role can’t record acceptances.')
  if ((await caseWorkflow(application)).state.type !== 'offer') fail(409, 'There is no offer waiting to be accepted.', 'invalid_state')
  if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired.', 'offer_expired')
  return signOfferDocuments({ application, signature: parseSignature(input.signature), req, capturedBy: viewer })
}

/** The code the customer received by email, read out to the staff member recording an in-person acceptance. */
const verifyAcceptanceCode = async (req, viewer, application, input) => {
  requirePermission(viewer, 'offers.record', 'Your role can’t record acceptances.')
  const code = text(input.code, 12)
  if (!code) fail(400, 'Enter the code the customer received by email.', 'invalid_input')
  const otpError = await checkOtp({ email: application.applicantEmail, code, purpose: 'offer', req })
  if (otpError) fail(otpError.status, otpError.message.replace('The code entered', 'The customer’s code'), 'invalid_code')
  return true
}

const act = async (req, res, { params }) => {
  const viewer = await requireUser(req, { staff: true })
  const application = await findVisibleApplication(viewer, params.id)
  const input = { ...(req.body || {}) }
  const { requireSignature } = await getSetting('offers')
  // The customer's emailed code is checked once, here, where the caller's address is known
  // for the guess limits; the action itself then trusts that check.
  const codeVerified = input.action === 'record_acceptance' ? await verifyAcceptanceCode(req, viewer, application, input) : false
  const signed = input.action === 'record_acceptance' && requireSignature ? await signInPerson(req, viewer, application, input) : null
  if (signed) input.signatureId = signed.id
  let outcome
  try {
    outcome = await applyAction(viewer, application.id, input, { codeVerified })
  } catch (error) {
    await discardSignature(signed)
    throw error
  }
  const { application: updated, result } = outcome
  await recordAudit({ req, actor: viewer, action: `application.${input.action}`, entityType: 'application', entityId: application.id, detail: { reference: application.reference, status: updated.status } })

  if (result.consumeOtpFor) await consumeOtp('offer', result.consumeOtpFor)
  // The offer letter is made from the published template straight away.
  if (result.approved) afterResponse('offer documents', () => ensureOfferDocuments(updated.id))
  if (updated.state !== application.state) sendStageDocuments(req, updated, viewer)
  notifyStaffAbout(req, viewer, input.action, result, updated)
  if (result.notify) notifyCustomer(req, updated, result.notify)
  // Whichever state the workflow marks for it (Workflow editor) hands the loan to the LMS.
  if (result.handToLms) await handToLms(updated, viewer)
  return loadCase(application.id, viewer)
}

/** Everyone who reviews cases, for the "assign to" picker. */
const listOfficers = async (req) => {
  await requireUser(req, { staff: true })
  const db = await getDb()
  const reviewerRoles = await rolesWith('cases.work')
  const officers = await db
    .select({ id: users.id, name: users.name, role: users.role, approvalMin: users.approvalMin, approvalMax: users.approvalMax })
    .from(users)
    .where(and(inArray(users.role, reviewerRoles), eq(users.status, 'active')))
    .orderBy(asc(users.name))
  return { officers }
}

/** Staff add a document to a case (collected in person, or a better copy). */
const addStaffDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'applications.note' })
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
  const viewer = await requireUser(req, { permission: 'cases.work' })
  const application = await findVisibleApplication(viewer, params.id)
  await runPrescreen(application.id, { actor: viewer })
  await recordAudit({ req, actor: viewer, action: 'application.prescreen_rerun', entityType: 'application', entityId: application.id })
  return loadCase(application.id, viewer)
}

/** A field visit: where the staff member is now, with a note. Needs their device's location. */
const logVisit = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'applications.note' })
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
  const viewer = await requireUser(req, { permission: 'cases.work' })
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

  // Back to where the case was: its state's category (the state itself never changed).
  const { flow, state } = await caseWorkflow(application)
  const nextStatus = flow.analysis.categories[state.id]
  await db.transaction(async (tx) => {
    // Only from the state the customer saw: staff may have moved the case on meanwhile.
    const [updated] = await tx
      .update(applications)
      .set({ status: nextStatus, infoRequest: null, version: application.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.status, application.status), eq(applications.version, application.version)))
      .returning({ id: applications.id })
    if (!updated) fail(409, 'This application changed while you were replying. Refresh the page.', 'stale')
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
  const { state } = await caseWorkflow(application)
  if (state.type !== 'offer' || application.status !== 'approved') fail(409, 'There is no offer waiting for you on this application.', 'invalid_state')
  if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired. You are welcome to apply again.', 'offer_expired')

  // With signing on: they have read the documents, signed, and entered the code we emailed.
  const { requireSignature } = await getSetting('offers')
  let signed = null
  if (requireSignature) {
    if (req.body?.agreed !== true) fail(400, 'Confirm that you have read the offer letter.', 'agreement_required')
    const signature = parseSignature(req.body?.signature)
    const code = text(req.body?.code, 12)
    if (!code) fail(400, 'Enter the code we emailed you.', 'code_required')
    const otpError = await checkOtp({ email: application.applicantEmail, code, purpose: 'sign', req })
    if (otpError) fail(otpError.status, otpError.message, 'invalid_code')
    signed = await signOfferDocuments({ application, signature, req })
  }

  const db = await getDb()
  let accepted
  try {
    accepted = await db.transaction(async (tx) => {
      const moved = await systemTransition(tx, application, state.offer.onAccept, {
        expectState: state.id,
        actor: viewer,
        changes: { acceptedAt: new Date() },
        event: { type: 'status', message: signed ? `Offer accepted and signed by ${signed.signerName}` : 'Offer accepted', visibleToCustomer: true },
      })
      if (!moved) fail(409, 'This offer changed. Refresh the page.', 'stale')
      await tx.insert(consents).values({
        applicationId: application.id,
        type: 'offer',
        granted: true,
        noticeVersion: signed ? `${offerTerms(application)}:signature ${signed.id}` : offerTerms(application),
        method: signed ? 'signature_and_code' : 'applicant_checkbox',
        capturedBy: viewer.id,
        ip: clientIpOf(req),
      })
      return moved
    })
  } catch (error) {
    await discardSignature(signed)
    throw error
  }
  if (signed) await consumeOtp('sign', application.applicantEmail)
  await recordAudit({ req, actor: viewer, action: 'application.offer_accepted', entityType: 'application', entityId: application.id, detail: { reference: application.reference, signature: signed?.id ?? null } })
  afterResponse('staff notifications', async () =>
    notifyUsers(followerIds(application).length ? followerIds(application) : await creditStaffIds(), { type: 'offer_accepted', title: `${application.reference}: offer accepted`, body: 'Ready for payout.', applicationId: application.id }, { origin: appOrigin(req) })
  )
  sendStageDocuments(req, accepted.application, viewer)
  if (accepted.target.handToLms) await handToLms(accepted.application)
  return { ok: true }
}

/** The customer withdraws (including turning down an offer). */
const withdrawApplication = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  if (!WITHDRAWABLE_STATUSES.includes(application.status)) fail(409, 'This application can no longer be withdrawn.', 'invalid_state')
  const why = text(req.body?.reason, 500) || (application.status === 'approved' ? 'Turned down the offer' : 'Withdrawn by the applicant')
  const db = await getDb()
  // A payout or acceptance landing at the same moment must win, not be overwritten.
  const moved = await systemTransition(db, application, 'withdrawn', {
    actor: viewer,
    changes: { withdrawnAt: new Date(), closedReason: why },
    event: { type: 'status', message: application.status === 'approved' ? `Offer turned down: ${why}` : `Withdrawn: ${why}`, visibleToCustomer: true },
  })
  if (!moved) fail(409, 'This application changed a moment ago. Refresh the page to see where it stands.', 'stale')
  await recordAudit({ req, actor: viewer, action: 'application.withdrawn', entityType: 'application', entityId: application.id, detail: { reference: application.reference } })
  return { ok: true }
}

/** Cron: offers not accepted in time lapse, and the customer is told. */
export const expireOffers = async (origin) => {
  const db = await getDb()
  // Only offers get a deadline (on entering the offer state), so these are all offers.
  const due = await db
    .select()
    .from(applications)
    .where(and(eq(applications.status, 'approved'), lt(applications.offerExpiresAt, new Date())))
  const lapsed = []
  for (const candidate of due) {
    const moved = await systemTransition(db, candidate, 'expired', {
      expectState: candidate.state,
      changes: { closedReason: 'Offer not accepted in time' },
      event: { type: 'status', message: 'The offer expired before it was accepted', visibleToCustomer: true },
    })
    if (moved) lapsed.push(moved.application)
  }
  for (const application of lapsed) {
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
  await requireUser(req, { anyPermission: ['rules.view', 'rules.manage'] })
  const [published, draft, history] = await Promise.all([getPublishedRuleset(), getDraftRuleset(), listRulesetHistory()])
  return {
    published: { version: published.version, policies: rulesToPolicies(published.rules), publishedAt: published.publishedAt, note: published.note },
    draft: draft ? { policies: rulesToPolicies(draft.rules), note: draft.note } : null,
    history,
    facts: FACTS,
  }
}

const saveDraft = async (req) => {
  const actor = await requireUser(req, { permission: 'rules.manage' })
  let policies
  try {
    policies = validatePolicies(req.body?.policies)
  } catch (error) {
    fail(400, error.message, 'invalid_rules')
  }
  const draft = await saveDraftRuleset({ policies }, text(req.body?.note, 300) || null, actor)
  await recordAudit({ req, actor, action: 'rules.draft_saved', entityType: 'ruleset', entityId: draft.id, detail: { policies: policies.length } })
  return { draft: { policies, note: draft.note } }
}

const discardDraft = async (req) => {
  const actor = await requireUser(req, { permission: 'rules.manage' })
  const draft = await getDraftRuleset()
  if (draft) {
    const db = await getDb()
    await db.delete(schema.rulesets).where(eq(schema.rulesets.id, draft.id))
    await recordAudit({ req, actor, action: 'rules.draft_discarded', entityType: 'ruleset', entityId: draft.id })
  }
  return { ok: true }
}

/** Every published or retired version with its policies, newest first (for viewing and restoring). */
const listVersions = async (req) => {
  await requireUser(req, { anyPermission: ['rules.view', 'rules.manage'] })
  const db = await getDb()
  const rows = await db.select().from(schema.rulesets).where(ne(schema.rulesets.status, 'draft')).orderBy(desc(schema.rulesets.version)).limit(30)
  return {
    versions: rows.map((row) => ({ version: row.version, status: row.status, note: row.note, publishedAt: row.publishedAt, policies: rulesToPolicies(row.rules) })),
  }
}

/** Copies an earlier version into the draft. Nothing is published until an admin does so. */
const restoreVersion = async (req) => {
  const actor = await requireUser(req, { permission: 'rules.manage' })
  const version = Number(req.body?.version)
  if (!Number.isInteger(version)) fail(400, 'Choose a version to restore.', 'invalid_version')
  const db = await getDb()
  const [row] = await db.select().from(schema.rulesets).where(eq(schema.rulesets.version, version)).limit(1)
  if (!row) fail(404, 'That version does not exist.', 'not_found')
  let policies
  try {
    policies = validatePolicies(rulesToPolicies(row.rules))
  } catch (error) {
    fail(400, error.message, 'invalid_rules')
  }
  const draft = await saveDraftRuleset({ policies }, `Restored from version ${version}`, actor)
  await recordAudit({ req, actor, action: 'rules.version_restored', entityType: 'ruleset', entityId: draft.id, detail: { fromVersion: version, policies: policies.length } })
  return { draft: { policies, note: draft.note } }
}

const SIMULATION_SAMPLE = 300

/**
 * Replays recent applications' stored facts through proposed rules, so an admin sees how
 * outcomes would change before publishing. Uses the facts recorded at prescreen time.
 */
const simulate = async (req) => {
  await requireUser(req, { permission: 'rules.manage' })
  let rules
  try {
    rules = flattenPolicies(validatePolicies(req.body?.policies))
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
  const actor = await requireUser(req, { permission: 'rules.manage' })
  const published = await publishDraftRuleset(actor, text(req.body?.note, 300) || null)
  if (!published) fail(400, 'There is no draft to publish.', 'no_draft')
  await recordAudit({ req, actor, action: 'rules.published', entityType: 'ruleset', entityId: published.id, detail: { version: published.version } })
  return { published }
}

/** Facts for an application, recomputed now — for the "why" panel when no prescreen exists yet. */
const previewFacts = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'cases.work' })
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
  ['GET', '/rules/versions', listVersions],
  ['POST', '/rules/restore', restoreVersion],
  ['PUT', '/rules/draft', saveDraft],
  ['DELETE', '/rules/draft', discardDraft],
  ['POST', '/rules/simulate', simulate],
  ['POST', '/rules/publish', publish],
]

