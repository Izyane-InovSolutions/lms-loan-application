import { and, eq } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text } from './http.js'
import { requirePermission } from './rbac.js'
import { roleHas } from './roles.js'
import { addEvent } from './applications.js'
import { getSetting } from './settings.js'
import { OPEN_STATUSES, WITHDRAWABLE_STATUSES } from '../../src/config/applications.js'
import { STAGE_PHASES, checkLabel, checklistOf, findStage, pendingStages, phaseForStatus, stagesFor } from '../../src/config/stages.js'
import { checkOtp } from './otp.js'
import { signatureFor } from './signing.js'
import { priceLoan } from '../../src/config/loanProducts.js'
import { getProducts } from './products.js'

const { applications, appraisals, users } = schema

/*
 * The appraisal workflow, as one function per action. Each runs in a transaction against
 * the row it read, bumps `version`, and writes its timeline entry, so a transition and
 * its record can never come apart.
 *
 *   submitted ──start──▶ in_review ──recommend──▶ pending_approval ──decide──▶ approved / declined
 *        ▲                  │  ▲                        │                       │
 *        └── respond ── info_requested            return (back to in_review)    ▼
 *                                                          accepted (customer) ─▶ disbursed
 *   Any open or approved case can be withdrawn; an unaccepted offer expires.
 *
 * Each action needs a permission (src/config/roles.js), whatever the role is called:
 *   assign, start_review, request_info, check   cases.work (assigning someone else: cases.assign)
 *   recommend                                   cases.recommend
 *   decide                                      cases.decide
 *   record_acceptance, withdraw                 offers.record
 *   note                                        applications.note
 *   mark_disbursed                              cases.disburse
 *   complete_stage                              the stage's roles, else its phase's permission
 *   reopen_stage                                cases.work
 *
 * The workspace's own stages (Settings → Stages, src/config/stages.js) sit inside the
 * backbone: review stages must all be done before a recommendation, approval stages before
 * a decision, closing stages before payout.
 *
 * Guard rails (Settings → Workflow):
 *   - four-eyes: whoever recommends, or brought the customer in, cannot give the decision;
 *   - each person decides within their own approval band (Team → their profile).
 */

const requireCase = (viewer, permission) => requirePermission(viewer, permission, 'Your role can’t do this on a case.')

const requireStatus = (application, allowed, message) => {
  if (!allowed.includes(application.status)) fail(409, message, 'invalid_state')
}

const reason = (input, message = 'Add a short explanation.') => {
  const value = text(input, 2000)
  if (value.length < 3) fail(400, message, 'invalid_input')
  return value
}

/** Approved amount and tenure, defaulting to what was asked for and held to the product limits. */
const terms = (application, input, settings) => {
  const product = settings.products.find((entry) => entry.id === application.loanType)
  const amount = input.amount === undefined || input.amount === '' ? application.amount : Number(input.amount)
  const tenure = input.tenure === undefined || input.tenure === '' ? application.tenure : Number(input.tenure)
  if (!Number.isFinite(amount) || amount < product.minAmount || amount > product.maxAmount) {
    fail(400, `The amount must be between K${product.minAmount.toLocaleString()} and K${product.maxAmount.toLocaleString()}.`, 'invalid_amount')
  }
  if (!Number.isInteger(tenure) || tenure < product.minTenure || tenure > product.maxTenure) {
    fail(400, `The tenure must be between ${product.minTenure} and ${product.maxTenure} months.`, 'invalid_tenure')
  }
  return { amount, tenure }
}

const requireAssignmentRange = (person, application) => {
  const min = person.approvalMin ?? 0
  const max = person.approvalMax ?? null
  if (application.amount < min || (max != null && application.amount > max)) {
    const upper = max == null ? 'no upper limit' : `K${max.toLocaleString()}`
    fail(403, `${person.name} cannot be assigned applications outside K${min.toLocaleString()} to ${upper}.`, 'outside_approval_range')
  }
}

const ACTIONS = {
  /** Someone takes a case, or hands it to a colleague who reviews cases. */
  async assign(tx, viewer, application, input) {
    requireCase(viewer, 'cases.work')
    requireStatus(application, OPEN_STATUSES, 'This case is closed.')
    const officerId = input.officerId || viewer.id
    if (officerId !== viewer.id) requireCase(viewer, 'cases.assign')
    const [person] = await tx.select().from(users).where(eq(users.id, officerId)).limit(1)
    if (!person || person.status !== 'active' || !(await roleHas(person.role, 'cases.work'))) fail(400, 'Choose an active loan officer.', 'invalid_officer')
    requireAssignmentRange(person, application)
    return {
      changes: { assignedOfficer: person.id },
      event: { type: 'assignment', message: person.id === viewer.id ? `${viewer.name} took the case` : `Assigned to ${person.name}` },
    }
  },

  async start_review(tx, viewer, application) {
    requireCase(viewer, 'cases.work')
    requireStatus(application, ['submitted'], 'Only a newly submitted case can be started.')
    if (!application.assignedOfficer) requireAssignmentRange(viewer, application)
    return {
      changes: { status: 'in_review', assignedOfficer: application.assignedOfficer || viewer.id },
      event: { type: 'status', message: 'Review started', visibleToCustomer: true },
    }
  },

  /** Asks the applicant (or their agent) for something; they answer from their page. */
  async request_info(tx, viewer, application, input) {
    requireCase(viewer, 'cases.work')
    requireStatus(application, ['submitted', 'in_review'], 'Information can only be requested while a case is being reviewed.')
    const message = reason(input.message, 'Say what the applicant needs to send or explain.')
    return {
      changes: { status: 'info_requested', infoRequest: { message, requestedBy: viewer.name, requestedAt: new Date().toISOString() } },
      event: { type: 'info_request', message, visibleToCustomer: true },
      notify: { headline: 'We need something from you', body: `Please send us the following so we can continue with your application: ${message}` },
    }
  },

  /** Ticks or clears a checklist item. Ticking needs a note of what was seen. */
  async check(tx, viewer, application, input, settings) {
    requireCase(viewer, 'cases.work')
    requireStatus(application, ['submitted', 'in_review', 'info_requested'], 'The checklist is locked once a recommendation is made.')
    const item = checklistOf(settings.stages).find((check) => check.key === input.check)
    if (!item) fail(400, 'Unknown check.', 'invalid_input')
    const done = Boolean(input.done)
    const note = done ? reason(input.note, 'Note what you checked, e.g. which document or reference.') : text(input.note, 500)
    const checks = { ...(application.checks || {}), [input.check]: { done, note, by: viewer.name, at: new Date().toISOString() } }
    return {
      changes: { checks },
      event: { type: 'check', message: `${item.label}: ${done ? 'done' : 'reopened'}${note ? ` (${note})` : ''}` },
    }
  },

  /**
   * The officer's recommendation. With four-eyes on it waits for someone else; with it
   * off, the officer's own call stands (within their limit).
   */
  async recommend(tx, viewer, application, input, settings) {
    requireCase(viewer, 'cases.recommend')
    requireStatus(application, ['in_review'], 'Start the review before recommending.')
    const verdict = input.verdict
    if (!['approve', 'decline'].includes(verdict)) fail(400, 'Choose approve or decline.', 'invalid_input')
    const rationale = reason(input.rationale, 'Explain the recommendation for the approver.')
    const conditions = text(input.conditions, 2000) || null
    const { amount, tenure } = verdict === 'approve' ? terms(application, input, settings) : { amount: null, tenure: null }

    requireStagesDone(settings, 'review', application)
    if (verdict === 'approve') {
      const missing = checklistOf(settings.stages).filter((check) => check.requiredToApprove && !application.checks?.[check.key]?.done)
      if (missing.length) fail(400, `Complete these checks first: ${missing.map((check) => check.label.toLowerCase()).join(', ')}.`, 'checks_incomplete')
    }

    await tx.insert(appraisals).values({
      applicationId: application.id,
      kind: 'recommendation',
      verdict,
      amount,
      tenure,
      conditions,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })

    // Approval stages (a credit committee, say) need somewhere to happen, four-eyes or not.
    if (settings.workflow.requireSecondApproval || stagesFor(settings.stages, 'approval', application.loanType).length) {
      return {
        changes: { status: 'pending_approval', assignedOfficer: application.assignedOfficer || viewer.id },
        event: { type: 'recommendation', message: `Recommended ${verdict === 'approve' ? `approval of K${amount.toLocaleString()} over ${tenure} months` : 'decline'}: ${rationale}` },
      }
    }
    return finalDecision(tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal: false })
  },

  /** The second person's decision on a recommendation. */
  async decide(tx, viewer, application, input, settings) {
    requireCase(viewer, 'cases.decide')
    requireStatus(application, ['pending_approval'], 'This case is not waiting for a decision.')
    const verdict = input.verdict
    if (!['approve', 'decline', 'return'].includes(verdict)) fail(400, 'Choose approve, decline or send back.', 'invalid_input')
    const rationale = reason(input.rationale, 'Explain the decision.')

    const [recommendation] = await tx
      .select()
      .from(appraisals)
      .where(and(eq(appraisals.applicationId, application.id), eq(appraisals.kind, 'recommendation')))
      .orderBy(appraisals.createdAt)
      .then((rows) => rows.slice(-1))
    if (settings.workflow.requireSecondApproval && recommendation?.officerId === viewer.id) {
      fail(403, 'A different person must decide a case you recommended.', 'four_eyes')
    }

    if (verdict === 'return') {
      await tx.insert(appraisals).values({ applicationId: application.id, kind: 'decision', verdict: 'return', rationale, officerId: viewer.id, officerName: viewer.name })
      // The next recommendation goes through the approval stages afresh.
      return {
        changes: { status: 'in_review', stageProgress: withoutPhase(settings, 'approval', application) },
        event: { type: 'decision', message: `Sent back for more work: ${rationale}` },
      }
    }
    requireStagesDone(settings, 'approval', application)

    const amount = verdict === 'approve' ? input.amount ?? recommendation?.amount : null
    const tenure = verdict === 'approve' ? input.tenure ?? recommendation?.tenure : null
    const conditions = text(input.conditions, 2000) || recommendation?.conditions || null
    return finalDecision(tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal: true })
  },

  /**
   * The customer accepted the offer in person: the agent or officer enters the code the
   * customer received by email, as proof it was them.
   */
  async record_acceptance(tx, viewer, application, input, settings, context) {
    requireCase(viewer, 'offers.record')
    requireStatus(application, ['approved'], 'There is no offer waiting to be accepted.')
    if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired.', 'offer_expired')
    // The handler checks the customer's code before the transaction (handlers/workflow.js).
    if (!context?.codeVerified) {
      const code = text(input.code, 12)
      if (!code) fail(400, 'Enter the code the customer received by email.', 'invalid_input')
      const otpError = await checkOtp({ email: application.applicantEmail, code, purpose: 'offer' })
      if (otpError) fail(otpError.status, otpError.message.replace('The code entered', 'The customer’s code'), 'invalid_code')
    }
    // With signing on, the handler has the customer sign first (signing.js) and passes the result.
    const signature = settings.offers.requireSignature ? await signatureFor(tx, application.id, input.signatureId) : null
    if (settings.offers.requireSignature && !signature) fail(400, 'The customer needs to sign the offer first.', 'signature_required')
    return {
      changes: { status: 'accepted', acceptedAt: new Date() },
      event: {
        type: 'status',
        message: signature ? `Offer accepted and signed by ${signature.signerName}, in person with ${viewer.name}` : `Offer accepted by the customer, recorded by ${viewer.name}`,
        visibleToCustomer: true,
      },
      accepted: true,
      consumeOtpFor: application.applicantEmail,
    }
  },

  /** Withdraws the application at the customer's request (recorded by staff). */
  async withdraw(tx, viewer, application, input) {
    requireCase(viewer, 'offers.record')
    requireStatus(application, WITHDRAWABLE_STATUSES, 'This application can no longer be withdrawn.')
    const why = reason(input.reason, 'Note why the customer is withdrawing.')
    return {
      changes: { status: 'withdrawn', withdrawnAt: new Date(), closedReason: why },
      event: { type: 'status', message: `Withdrawn at the customer’s request: ${why}`, customerMessage: 'The application was withdrawn at your request.', visibleToCustomer: true },
    }
  },

  async note(tx, viewer, application, input) {
    requireCase(viewer, 'applications.note')
    const message = reason(input.message, 'Write the note.')
    return { changes: {}, event: { type: 'note', message } }
  },

  /** Records that the loan was paid out, when the LMS does not report it back. */
  async mark_disbursed(tx, viewer, application, input, settings) {
    requireCase(viewer, 'cases.disburse')
    const ready = settings.offers.requireAcceptance ? ['accepted'] : ['approved', 'accepted']
    requireStatus(application, ready, settings.offers.requireAcceptance ? 'The customer must accept the offer before it is paid out.' : 'Only an approved loan can be marked as paid out.')
    requireStagesDone(settings, 'closing', application)
    const reference = text(input.reference, 100)
    return {
      changes: { status: 'disbursed' },
      event: { type: 'status', message: reference ? `Paid out (${reference})` : 'Paid out', visibleToCustomer: true },
    }
  },

  /**
   * Marks the case's current stage done. Stages go in order, need their checklist items
   * ticked first, and may be limited to some roles; an approval stage may need someone
   * other than the recommender or whoever brought the case in.
   */
  async complete_stage(tx, viewer, application, input, settings) {
    const found = findStage(settings.stages, input.stage)
    if (!found || !stagesFor(settings.stages, found.phase, application.loanType).some((stage) => stage.id === found.stage.id)) {
      fail(400, 'This stage isn’t part of this case’s flow.', 'invalid_input')
    }
    const { phase, stage } = found
    const active = phaseForStatus(application.status, { requireAcceptance: settings.offers.requireAcceptance })
    if (active !== phase) fail(409, `“${stage.label}” can only be done ${STAGE_PHASES[phase].label.toLowerCase()}.`, 'invalid_state')
    const [current] = pendingStages(settings.stages, phase, application)
    if (!current) fail(409, 'Every stage here is already done.', 'invalid_state')
    if (current.id !== stage.id) fail(409, `Finish “${current.label}” first.`, 'stage_order')
    requireStageRole(viewer, stage, phase)

    const missing = stage.checks.filter((key) => !application.checks?.[key]?.done)
    if (missing.length) fail(400, `Tick these checks first: ${missing.map((key) => checkLabel(settings.stages, key).toLowerCase()).join(', ')}.`, 'checks_incomplete')

    if (phase === 'approval' && stage.differentPerson) {
      const [recommendation] = await tx
        .select()
        .from(appraisals)
        .where(and(eq(appraisals.applicationId, application.id), eq(appraisals.kind, 'recommendation')))
        .orderBy(appraisals.createdAt)
        .then((rows) => rows.slice(-1))
      if (recommendation?.officerId === viewer.id || application.sourcedBy === viewer.id) {
        fail(403, `Someone other than the recommender, or whoever brought the case in, must complete “${stage.label}”.`, 'four_eyes')
      }
    }

    const note = text(input.note, 1000)
    const stageProgress = { ...(application.stageProgress || {}), [stage.id]: { done: true, note: note || null, by: viewer.id, byName: viewer.name, at: new Date().toISOString() } }
    const phaseDone = pendingStages(settings.stages, phase, { ...application, stageProgress }).length === 0
    return {
      changes: { stageProgress },
      event: { type: 'stage', message: `${stage.label}: done${note ? ` (${note})` : ''}` },
      // The last closing stage releases the loan to the LMS.
      closingDone: phase === 'closing' && phaseDone,
    }
  },

  /** Undoes a stage, and every later one in its phase, while that phase is still open. */
  async reopen_stage(tx, viewer, application, input, settings) {
    requireCase(viewer, 'cases.work')
    const found = findStage(settings.stages, input.stage)
    if (!found || !application.stageProgress?.[found.stage.id]?.done) fail(400, 'This stage isn’t done.', 'invalid_input')
    const active = phaseForStatus(application.status, { requireAcceptance: settings.offers.requireAcceptance })
    if (active !== found.phase) fail(409, 'This part of the flow is over; the stage can no longer be reopened.', 'invalid_state')
    const why = reason(input.reason, 'Say why the stage is being reopened.')
    const stages = stagesFor(settings.stages, found.phase, application.loanType)
    const from = stages.findIndex((stage) => stage.id === found.stage.id)
    const stageProgress = { ...(application.stageProgress || {}) }
    stages.slice(from).forEach((stage) => delete stageProgress[stage.id])
    return { changes: { stageProgress }, event: { type: 'stage', message: `${found.stage.label}: reopened (${why})` } }
  },
}

/** Throws unless every stage of `phase` that applies to the case is done. */
const requireStagesDone = (settings, phase, application) => {
  const pending = pendingStages(settings.stages, phase, application)
  if (pending.length) fail(409, `Finish these stages first: ${pending.map((stage) => stage.label).join(', ')}.`, 'stages_incomplete')
}

/** A stage limited to roles is theirs (and admins'); otherwise it needs its phase's permission. */
const requireStageRole = (viewer, stage, phase) => {
  if (viewer.role === 'admin') return
  if (stage.roles.length) {
    if (!stage.roles.includes(viewer.role)) fail(403, `Your role can’t complete “${stage.label}”.`, 'forbidden')
    return
  }
  requireCase(viewer, STAGE_PHASES[phase].defaultPermission)
}

const withoutPhase = (settings, phase, application) => {
  const stageProgress = { ...(application.stageProgress || {}) }
  stagesFor(settings.stages, phase, application.loanType).forEach((stage) => delete stageProgress[stage.id])
  return stageProgress
}

/** Approve or decline, enforcing four-eyes against the originator and the approver's limit. */
const finalDecision = async (tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal }) => {
  if (settings.workflow.requireSecondApproval && application.sourcedBy === viewer.id) {
    fail(403, 'A different person must decide a case you brought in.', 'four_eyes')
  }
  let approved = null
  if (verdict === 'approve') {
    approved = terms(application, { amount, tenure }, settings)
    const min = viewer.approvalMin ?? 0
    const max = viewer.approvalMax ?? null
    if (approved.amount < min) {
      fail(403, `You can only approve amounts of K${min.toLocaleString()} or more.`, 'under_limit')
    }
    if (max != null && approved.amount > max) {
      fail(403, `Approvals above K${max.toLocaleString()} are outside your limit.`, 'over_limit')
    }
  }
  if (recordAppraisal) {
    await tx.insert(appraisals).values({
      applicationId: application.id,
      kind: 'decision',
      verdict,
      amount: approved?.amount ?? null,
      tenure: approved?.tenure ?? null,
      conditions,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })
  }

  if (verdict === 'approve') {
    const changed = approved.amount !== application.amount || approved.tenure !== application.tenure
    const needsAcceptance = settings.offers.requireAcceptance
    return {
      changes: {
        status: 'approved',
        decidedAt: new Date(),
        approvedAmount: approved.amount,
        approvedTenure: approved.tenure,
        offerExpiresAt: needsAcceptance ? new Date(Date.now() + settings.offers.expiryDays * 86400000) : null,
        ...(changed
          ? {
              ...(() => {
                const price = priceLoan(approved.amount, approved.tenure, settings.products.find((entry) => entry.id === application.loanType))
                return { totalRepayable: price.total, monthlyInstalment: price.monthly }
              })(),
            }
          : {}),
      },
      event: {
        type: 'decision',
        message: `Approved K${approved.amount.toLocaleString()} over ${approved.tenure} months${conditions ? `. Conditions: ${conditions}` : ''}`,
        visibleToCustomer: true,
      },
      approved: true,
      notify: {
        headline: 'Your loan has been approved',
        body: needsAcceptance
          ? `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. Sign in to review and accept the offer within ${settings.offers.expiryDays} days.`
          : `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. We will contact you about the next steps.`,
      },
    }
  }
  return {
    changes: { status: 'declined', decidedAt: new Date() },
    // The applicant sees the outcome, not the internal rationale.
    event: { type: 'decision', message: `Declined: ${rationale}`, customerMessage: 'We were not able to approve this application.', visibleToCustomer: true },
    notify: { headline: 'An update on your application', body: 'We were not able to approve your application this time. You are welcome to apply again in future.' },
  }
}

/**
 * Applies one action. `input.version` must match the row, so an action taken on a stale
 * screen is refused with a prompt to refresh instead of overwriting a colleague's work.
 * Returns { application, result } where result carries `approved` / `notify` hints.
 */
export const applyAction = async (viewer, applicationId, input, context = {}) => {
  const handler = ACTIONS[input?.action]
  if (!handler) fail(400, 'Unknown action.', 'invalid_input')
  const settings = { workflow: await getSetting('workflow'), offers: await getSetting('offers'), products: await getProducts(), stages: await getSetting('stages') }
  const db = await getDb()

  return db.transaction(async (tx) => {
    const [application] = await tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
    if (!application) fail(404, 'Application not found.', 'not_found')
    if (Number(input.version) !== application.version) {
      fail(409, 'Someone else has updated this case. Refresh to see their changes before you continue.', 'stale')
    }

    const result = await handler(tx, viewer, application, input, settings, context)
    const nextStatus = result.changes.status
    const [updated] = await tx
      .update(applications)
      .set({ ...result.changes, version: application.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.version, application.version)))
      .returning()
    if (!updated) fail(409, 'Someone else has updated this case. Refresh and try again.', 'stale')

    const { customerMessage, ...event } = result.event
    await addEvent(tx, {
      applicationId: application.id,
      actor: viewer,
      fromStatus: nextStatus && nextStatus !== application.status ? application.status : null,
      toStatus: nextStatus && nextStatus !== application.status ? nextStatus : null,
      ...event,
      // The customer-facing copy of a staff message, where the two differ.
      ...(customerMessage ? { detail: { customerMessage } } : {}),
    })
    return { application: updated, result }
  })
}
