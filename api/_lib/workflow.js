import { and, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text } from './http.js'
import { requirePermission } from './rbac.js'
import { listRoles, roleHas } from './roles.js'
import { addEvent } from './applications.js'
import { getSetting } from './settings.js'
import { getPublishedWorkflow, getWorkflowVersion } from './workflowVersions.js'
import { OPEN_STATUSES, WITHDRAWABLE_STATUSES } from '../../src/config/applications.js'
import { ACTION_KINDS, PHASES, actionPermission, SYSTEM_FINAL_IDS, actionTarget, appliesTo, forwardEdges, resolveState, stateById } from '../../src/config/workflow.js'
import { checkOtp } from './otp.js'
import { signatureFor } from './signing.js'
import { priceLoan } from '../../src/config/loanProducts.js'
import { getProducts } from './products.js'

const { applications, appraisals, users } = schema

/*
 * The workflow engine. A case follows the workflow version it started on
 * (workflow_versions, src/config/workflow.js): it sits in one of its states, and the
 * state's actions move it on. Each action runs in a transaction against the row it read,
 * bumps `version` and writes its timeline entry, so a transition and its record can never
 * come apart. `status` is kept as the state's reporting category.
 *
 * Graph actions come from the state (`transition` with its actionId). The older action
 * names still work and resolve to the current state's action of that kind:
 *   start_review → the move that claims the case      recommend → recommend (or approve/reject)
 *   decide → approve / reject / return                 complete_stage → the stage's move on
 *   mark_disbursed → pay out                           reopen_stage → send back to that step
 *
 * Always available, whatever the state: assign, check, note, request_info /
 * cancel_request (where the state allows asking the applicant), withdraw, and
 * record_acceptance on the offer state.
 *
 * Who may act: whoever holds the action's permission (src/config/roles.js); a state that
 * names roles narrows that to those roles (admins always). Naming a role never grants a
 * permission it lacks. An approval always stays within the
 * approver's own band, and an action marked four-eyes can't be taken by whoever
 * recommended the case or brought it in.
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
  const amount = input.amount === undefined || input.amount === '' || input.amount === null ? application.amount : Number(input.amount)
  const tenure = input.tenure === undefined || input.tenure === '' || input.tenure === null ? application.tenure : Number(input.tenure)
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

const latestRecommendation = async (tx, applicationId) =>
  (
    await tx
      .select()
      .from(appraisals)
      .where(and(eq(appraisals.applicationId, applicationId), eq(appraisals.kind, 'recommendation')))
      .orderBy(appraisals.createdAt)
  ).at(-1) || null

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The name a stage-like state goes by in messages ("Document check", not "Assessment: Document check"). */
const stepName = (state) => state.stageLabel || state.label

/** The case's workflow and the state it is in. Pass the transaction as `db` when inside one. */
const locate = async (application, db = null) => {
  const flow = await getWorkflowVersion(application.workflowVersion, db)
  const state = stateById(flow.definition, application.state) || stateById(flow.definition, flow.definition.start)
  return { flow, state }
}

/**
 * What entering `targetId` sets on a case: the state (a state for other products is
 * passed through), its category as `status`, the time it arrived, an empty queue slot,
 * and the offer's deadline when it is the offer state.
 */
export const entryChanges = (flow, application, targetId, settings, now = new Date()) => {
  const target = resolveState(flow.definition, targetId, application.loanType)
  if (!target) throw new Error(`Workflow v${flow.version} has no state “${targetId}” for ${application.loanType} loans.`)
  const changes = {
    state: target.id,
    workflowVersion: flow.version,
    status: flow.analysis.categories[target.id],
    stateEnteredAt: now,
    stateAssignee: null,
  }
  if (target.type === 'offer') {
    if (!settings?.offers) throw new Error('Entering the offer state needs the offer settings (its deadline).')
    changes.offerExpiresAt = new Date(now.getTime() + settings.offers.expiryDays * 86400000)
  }
  return { target, changes }
}

/** A state's way on for this product: its first move. */
const moveOf = (state) => (state?.actions || []).find((action) => action.kind === 'move') || null

/** Every state the forward edges reach from `id`, in the case's product. */
const laterStates = (definition, id, product) => {
  const found = new Set()
  const stack = [id]
  while (stack.length) {
    const state = resolveState(definition, stack.pop(), product)
    for (const edge of forwardEdges(state)) {
      const next = resolveState(definition, edge.to, product)
      if (next && !found.has(next.id)) {
        found.add(next.id)
        stack.push(next.id)
      }
    }
  }
  return found
}

/** The steps between the current state and the first one holding an action of `kinds`, for "finish these first". */
const stepsBefore = (definition, state, product, kinds) => {
  const steps = []
  let current = state
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if ((current.actions || []).some((action) => kinds.includes(action.kind))) return steps
    steps.push(current)
    const move = moveOf(current)
    current = move ? resolveState(definition, move.to, product) : null
  }
  return null
}

const requireStepsDone = (definition, state, product, kinds) => {
  const steps = stepsBefore(definition, state, product, kinds)
  if (steps?.length) fail(409, `Finish these stages first: ${steps.map(stepName).join(', ')}.`, 'stages_incomplete')
}

/** Clears the recorded progress of `from` and every later step in the same part of the journey. */
const progressWithout = (flow, application, fromId) => {
  const phase = flow.analysis.phases[fromId]
  const cleared = [fromId, ...laterStates(flow.definition, fromId, application.loanType)].filter((id) => flow.analysis.phases[id] === phase)
  const stageProgress = { ...(application.stageProgress || {}) }
  cleared.forEach((id) => delete stageProgress[id])
  return stageProgress
}

// ---------------------------------------------------------------------------
// Graph actions
// ---------------------------------------------------------------------------

/**
 * Whether `viewer` works on cases in `state`: someone who may take one of its actions (on
 * the offer, record the acceptance) and, where the state names roles, holds one of them.
 * Admins work everywhere.
 */
export const worksOn = (viewer, state) => {
  if (!state || state.type === 'final') return false
  if (viewer.role === 'admin') return true
  if (state.roles?.length && !state.roles.includes(viewer.role)) return false
  if (state.type === 'offer') return Boolean(viewer.permissions?.includes('offers.record'))
  return (state.actions || []).some((action) => viewer.permissions?.includes(actionPermission(action)))
}

/**
 * The cases in `viewer`'s queue, as a query condition: open cases in states they work on,
 * not waiting on the applicant, and not taken by someone else — in a state that names
 * roles, by whoever took it there; otherwise by the case's officer.
 */
export const queueCondition = async (viewer) => {
  const db = await getDb()
  const versions = (await db.selectDistinct({ version: applications.workflowVersion }).from(applications).where(notInArray(applications.state, SYSTEM_FINAL_IDS)))
    .map((row) => row.version)
    .filter(Boolean)
  const flows = await Promise.all(versions.map((version) => getWorkflowVersion(version)))
  const parts = []
  for (const flow of flows) {
    const mine = flow.definition.states.filter((state) => worksOn(viewer, state))
    const byRole = mine.filter((state) => state.roles?.length).map((state) => state.id)
    const byPermission = mine.filter((state) => !state.roles?.length).map((state) => state.id)
    const version = eq(applications.workflowVersion, flow.version)
    if (byRole.length) parts.push(and(version, inArray(applications.state, byRole), or(isNull(applications.stateAssignee), eq(applications.stateAssignee, viewer.id))))
    if (byPermission.length) parts.push(and(version, inArray(applications.state, byPermission), or(isNull(applications.assignedOfficer), eq(applications.assignedOfficer, viewer.id))))
  }
  if (!parts.length) return sql`false`
  return and(or(...parts), ne(applications.status, 'info_requested'))
}

/** The action's permission, and one of the state's roles where it names any. Admins always. */
const authorize = (viewer, state, action) => {
  if (viewer.role === 'admin') return
  const roles = state.roles || []
  if (roles.length && !roles.includes(viewer.role)) fail(403, `Your role can’t complete “${stepName(state)}”.`, 'forbidden')
  requireCase(viewer, actionPermission(action))
}

const assertFourEyes = async (tx, viewer, application) => {
  const recommendation = await latestRecommendation(tx, application.id)
  if (recommendation?.officerId === viewer.id) fail(403, 'A different person must decide a case you recommended.', 'four_eyes')
  if (application.sourcedBy === viewer.id) fail(403, 'A different person must decide a case you brought in.', 'four_eyes')
}

/** Finds the current state's action an older action name stands for, with the errors those names always gave. */
const resolveLegacyAction = (flow, state, application, input) => {
  const { definition } = flow
  const product = application.loanType
  const find = (predicate) => (state.actions || []).find(predicate) || null
  switch (input.action) {
    case 'start_review': {
      const action = find((entry) => entry.kind === 'move' && entry.options?.claim)
      if (!action) fail(409, 'Only a newly submitted case can be started.', 'invalid_state')
      return action
    }
    case 'recommend': {
      const direct = find((entry) => entry.kind === 'recommend')
      if (direct) return direct
      const single = find((entry) => (input.verdict === 'decline' ? entry.kind === 'reject' : entry.kind === 'approve') && entry.options?.singleStep)
      if (single) return single
      if (flow.analysis.phases[state.id] === 'review' && state.id !== definition.start) requireStepsDone(definition, state, product, ['recommend', 'approve'])
      return fail(409, 'Start the review before recommending.', 'invalid_state')
    }
    case 'decide': {
      const kinds = { approve: 'approve', decline: 'reject', return: 'return' }
      if (!kinds[input.verdict]) fail(400, 'Choose approve, decline or send back.', 'invalid_input')
      const action = find((entry) => entry.kind === kinds[input.verdict] && !entry.options?.singleStep)
      if (action) return action
      if (flow.analysis.categories[state.id] === 'pending_approval') requireStepsDone(definition, state, product, ['approve', 'reject'])
      return fail(409, 'This case is not waiting for a decision.', 'invalid_state')
    }
    case 'mark_disbursed': {
      const action = find((entry) => entry.kind === 'pay_out')
      if (action) return action
      if (state.type === 'offer') fail(409, 'The customer must accept the offer before it is paid out.', 'invalid_state')
      if (flow.analysis.phases[state.id] !== 'review') requireStepsDone(definition, state, product, ['pay_out'])
      return fail(409, 'Only an approved loan can be marked as paid out.', 'invalid_state')
    }
    case 'complete_stage': {
      const stage = stateById(definition, input.stage)
      if (!stage?.trackProgress || !appliesTo(stage, product)) fail(400, 'This stage isn’t part of this case’s flow.', 'invalid_input')
      if (stage.id === state.id) return moveOf(state)
      if (flow.analysis.phases[stage.id] === flow.analysis.phases[state.id] && laterStates(definition, state.id, product).has(stage.id)) {
        fail(409, `Finish “${stepName(state)}” first.`, 'stage_order')
      }
      if (application.stageProgress?.[stage.id]?.done) fail(409, 'Every stage here is already done.', 'invalid_state')
      return fail(409, `“${stepName(stage)}” can only be done ${PHASES[flow.analysis.phases[stage.id]].toLowerCase()}.`, 'invalid_state')
    }
    default:
      return null
  }
}

/** Runs a graph action: checks who and what, does the action's own work, and enters its target. */
const runTransition = async (tx, viewer, application, flow, state, action, input, settings) => {
  if (!action) fail(400, 'Unknown action.', 'invalid_input')
  const kind = ACTION_KINDS[action.kind]
  authorize(viewer, state, action)
  if (application.status === 'info_requested') fail(409, 'This case is waiting on the applicant. Cancel the request, or wait for their reply.', 'invalid_state')

  const verdict = action.kind === 'recommend' ? input.verdict : null
  if (action.kind === 'recommend' && !['approve', 'decline'].includes(verdict)) fail(400, 'Choose approve or decline.', 'invalid_input')
  const rationale =
    action.kind === 'recommend'
      ? reason(input.rationale, 'Explain the recommendation for the approver.')
      : ['approve', 'reject'].includes(action.kind)
        ? reason(input.rationale, 'Explain the decision.')
        : action.kind === 'return' || action.options?.requireNote
          ? reason(input.rationale ?? input.reason ?? input.note, 'Say why the case is being sent back.')
          : text(input.note ?? input.reference, 1000)
  const recommendTerms = action.kind === 'recommend' && verdict === 'approve' ? terms(application, input, settings) : null

  const neededChecks = [...(state.requiredChecks || []), ...(action.kind === 'recommend' && verdict !== 'approve' ? [] : action.options?.checks || [])]
  const missing = [...new Set(neededChecks)].filter((key) => !application.checks?.[key]?.done)
  if (missing.length) {
    const label = (key) => (flow.definition.checklist || []).find((check) => check.key === key)?.label?.toLowerCase() || key
    fail(400, `Complete these checks first: ${missing.map(label).join(', ')}.`, 'checks_incomplete')
  }
  if (action.options?.fourEyes) await assertFourEyes(tx, viewer, application)

  const changes = {}
  let event
  const result = { kind: action.kind }
  if (state.trackProgress && kind.forward) {
    changes.stageProgress = { ...(application.stageProgress || {}), [state.id]: { done: true, note: rationale || null, by: viewer.id, byName: viewer.name, at: new Date().toISOString() } }
  }

  if (action.kind === 'move') {
    if (action.options?.claim) {
      if (!application.assignedOfficer) requireAssignmentRange(viewer, application)
      changes.assignedOfficer = application.assignedOfficer || viewer.id
      event = { type: 'status', message: 'Review started', visibleToCustomer: true }
    } else {
      event = { type: state.trackProgress ? 'stage' : 'status', message: state.trackProgress ? `${stepName(state)}: done${rationale ? ` (${rationale})` : ''}` : `${action.label}${rationale ? ` (${rationale})` : ''}` }
    }
  } else if (action.kind === 'return') {
    changes.stageProgress = progressWithout(flow, application, actionTarget(flow.definition, action, application.loanType).id)
    event = { type: 'decision', message: `Sent back for more work: ${rationale}` }
  } else if (action.kind === 'recommend') {
    await tx.insert(appraisals).values({
      applicationId: application.id,
      kind: 'recommendation',
      verdict,
      amount: recommendTerms?.amount ?? null,
      tenure: recommendTerms?.tenure ?? null,
      conditions: text(input.conditions, 2000) || null,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })
    changes.assignedOfficer = application.assignedOfficer || viewer.id
    event = { type: 'recommendation', message: `Recommended ${verdict === 'approve' ? `approval of K${recommendTerms.amount.toLocaleString()} over ${recommendTerms.tenure} months` : 'decline'}: ${rationale}` }
    result.recommended = true
  } else if (action.kind === 'approve' || action.kind === 'reject') {
    Object.assign(result, await decision(tx, viewer, application, action, input, rationale, settings, flow, changes))
    event = result.event
  } else if (action.kind === 'pay_out') {
    event = { type: 'status', message: rationale ? `Paid out (${rationale})` : 'Paid out', visibleToCustomer: true }
  }

  // A return to a state that's off goes to the one before it; entering passes the rest through.
  const { target, changes: entry } = entryChanges(flow, application, actionTarget(flow.definition, action, application.loanType)?.id || action.to, settings)
  result.handToLms = Boolean(target.handToLms)
  result.enteredOffer = target.type === 'offer'
  return { changes: { ...changes, ...entry }, event, result, target }
}

/** Approve or reject: the terms, the approver's band, the appraisal record and the customer's message. */
const decision = async (tx, viewer, application, action, input, rationale, settings, flow, changes) => {
  const singleStep = Boolean(action.options?.singleStep)
  const recommendation = singleStep ? null : await latestRecommendation(tx, application.id)
  const conditions = text(input.conditions, 2000) || recommendation?.conditions || null
  const record = (verdict, approved) =>
    tx.insert(appraisals).values({
      applicationId: application.id,
      // With one person deciding, their recommendation is the decision (as it always was).
      kind: singleStep ? 'recommendation' : 'decision',
      verdict,
      amount: approved?.amount ?? null,
      tenure: approved?.tenure ?? null,
      conditions,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })

  if (action.kind === 'reject') {
    await record('decline', null)
    changes.decidedAt = new Date()
    if (singleStep) changes.assignedOfficer = application.assignedOfficer || viewer.id
    return {
      decided: 'declined',
      event: { type: 'decision', message: `Declined: ${rationale}`, customerMessage: 'We were not able to approve this application.', visibleToCustomer: true },
      notify: { headline: 'An update on your application', body: 'We were not able to approve your application this time. You are welcome to apply again in future.' },
    }
  }

  const approved = terms(application, { amount: input.amount ?? recommendation?.amount, tenure: input.tenure ?? recommendation?.tenure }, settings)
  const min = viewer.approvalMin ?? 0
  const max = viewer.approvalMax ?? null
  if (approved.amount < min) fail(403, `You can only approve amounts of K${min.toLocaleString()} or more.`, 'under_limit')
  if (max != null && approved.amount > max) fail(403, `Approvals above K${max.toLocaleString()} are outside your limit.`, 'over_limit')
  await record('approve', approved)

  Object.assign(changes, { decidedAt: new Date(), approvedAmount: approved.amount, approvedTenure: approved.tenure })
  if (singleStep) changes.assignedOfficer = application.assignedOfficer || viewer.id
  if (approved.amount !== application.amount || approved.tenure !== application.tenure) {
    const price = priceLoan(approved.amount, approved.tenure, settings.products.find((entry) => entry.id === application.loanType))
    Object.assign(changes, { totalRepayable: price.total, monthlyInstalment: price.monthly })
  }
  const toOffer = actionTarget(flow.definition, action, application.loanType)?.type === 'offer'
  return {
    decided: 'approved',
    approved: true,
    event: { type: 'decision', message: `Approved K${approved.amount.toLocaleString()} over ${approved.tenure} months${conditions ? `. Conditions: ${conditions}` : ''}`, visibleToCustomer: true },
    notify: {
      headline: 'Your loan has been approved',
      body: toOffer
        ? `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. Sign in to review and accept the offer within ${settings.offers.expiryDays} days.`
        : `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. We will contact you about the next steps.`,
    },
  }
}

// ---------------------------------------------------------------------------
// Actions available in any state
// ---------------------------------------------------------------------------

const UTILITY = {
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
      changes: { assignedOfficer: person.id, stateAssignee: person.id },
      event: { type: 'assignment', message: person.id === viewer.id ? `${viewer.name} took the case` : `Assigned to ${person.name}` },
    }
  },

  /** Takes the case from its state's queue: theirs to work in this state (and the case's officer, if it has none). */
  async take(tx, viewer, application, input, ctx) {
    requireStatus(application, OPEN_STATUSES, 'This case is closed.')
    if (!worksOn(viewer, ctx.state)) fail(403, `Your role doesn’t work on “${stepName(ctx.state)}”.`, 'forbidden')
    if (application.stateAssignee && application.stateAssignee !== viewer.id) fail(409, 'Someone else has taken this case here.', 'taken')
    requireAssignmentRange(viewer, application)
    return {
      changes: { stateAssignee: viewer.id, assignedOfficer: application.assignedOfficer || viewer.id },
      event: { type: 'assignment', message: `${viewer.name} took the case (${stepName(ctx.state)})` },
    }
  },

  /** Asks the applicant (or their agent) for something; they answer from their page. */
  async request_info(tx, viewer, application, input, ctx) {
    requireCase(viewer, 'cases.work')
    if (!ctx.state.askApplicant || application.status === 'info_requested') fail(409, 'Information can only be requested while a case is being reviewed.', 'invalid_state')
    const message = reason(input.message, 'Say what the applicant needs to send or explain.')
    return {
      changes: { status: 'info_requested', infoRequest: { message, requestedBy: viewer.name, requestedAt: new Date().toISOString() } },
      event: { type: 'info_request', message, visibleToCustomer: true },
      notify: { headline: 'We need something from you', body: `Please send us the following so we can continue with your application: ${message}` },
    }
  },

  /** Withdraws a request to the applicant that is no longer needed. */
  async cancel_request(tx, viewer, application, input, ctx) {
    requireCase(viewer, 'cases.work')
    requireStatus(application, ['info_requested'], 'Nothing is waiting on the applicant.')
    return {
      changes: { status: ctx.flow.analysis.categories[ctx.state.id], infoRequest: null },
      event: { type: 'info_request', message: `Request to the applicant withdrawn${text(input.reason, 500) ? `: ${text(input.reason, 500)}` : ''}`, customerMessage: 'We no longer need anything from you for now.', visibleToCustomer: true },
    }
  },

  /** Ticks or clears a checklist item. Ticking needs a note of what was seen. */
  async check(tx, viewer, application, input, ctx) {
    requireCase(viewer, 'cases.work')
    const listed = [...(ctx.state.requiredChecks || []), ...(ctx.state.actions || []).flatMap((action) => action.options?.checks || [])]
    if (!['submitted', 'in_review', 'info_requested'].includes(application.status) && !listed.includes(input.check)) {
      fail(409, 'The checklist is locked once a recommendation is made.', 'invalid_state')
    }
    const item = (ctx.flow.definition.checklist || []).find((check) => check.key === input.check)
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
   * The customer accepted the offer in person: the agent or officer enters the code the
   * customer received by email, as proof it was them.
   */
  async record_acceptance(tx, viewer, application, input, ctx, context) {
    requireCase(viewer, 'offers.record')
    if (ctx.state.type !== 'offer') fail(409, 'There is no offer waiting to be accepted.', 'invalid_state')
    if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired.', 'offer_expired')
    // The handler checks the customer's code before the transaction (handlers/workflow.js).
    if (!context?.codeVerified) {
      const code = text(input.code, 12)
      if (!code) fail(400, 'Enter the code the customer received by email.', 'invalid_input')
      const otpError = await checkOtp({ email: application.applicantEmail, code, purpose: 'offer' })
      if (otpError) fail(otpError.status, otpError.message.replace('The code entered', 'The customer’s code'), 'invalid_code')
    }
    // With signing on, the handler has the customer sign first (signing.js) and passes the result.
    const signature = ctx.settings.offers.requireSignature ? await signatureFor(tx, application.id, input.signatureId) : null
    if (ctx.settings.offers.requireSignature && !signature) fail(400, 'The customer needs to sign the offer first.', 'signature_required')
    const { target, changes } = entryChanges(ctx.flow, application, ctx.state.offer.onAccept, ctx.settings)
    return {
      changes: { ...changes, acceptedAt: new Date() },
      event: {
        type: 'status',
        message: signature ? `Offer accepted and signed by ${signature.signerName}, in person with ${viewer.name}` : `Offer accepted by the customer, recorded by ${viewer.name}`,
        visibleToCustomer: true,
      },
      accepted: true,
      handToLms: Boolean(target.handToLms),
      consumeOtpFor: application.applicantEmail,
    }
  },

  /** Withdraws the application at the customer's request (recorded by staff). */
  async withdraw(tx, viewer, application, input, ctx) {
    requireCase(viewer, 'offers.record')
    requireStatus(application, WITHDRAWABLE_STATUSES, 'This application can no longer be withdrawn.')
    const why = reason(input.reason, 'Note why the customer is withdrawing.')
    const { changes } = entryChanges(ctx.flow, application, 'withdrawn', ctx.settings)
    return {
      changes: { ...changes, withdrawnAt: new Date(), closedReason: why },
      event: { type: 'status', message: `Withdrawn at the customer’s request: ${why}`, customerMessage: 'The application was withdrawn at your request.', visibleToCustomer: true },
    }
  },

  async note(tx, viewer, application, input) {
    requireCase(viewer, 'applications.note')
    const message = reason(input.message, 'Write the note.')
    return { changes: {}, event: { type: 'note', message } }
  },

  /** Sends the case back to a step it already finished in this part of the journey, undoing it and those after it. */
  async reopen_stage(tx, viewer, application, input, ctx) {
    requireCase(viewer, 'cases.work')
    const stage = stateById(ctx.flow.definition, input.stage)
    if (!stage || !application.stageProgress?.[stage.id]?.done) fail(400, 'This stage isn’t done.', 'invalid_input')
    const { phases } = ctx.flow.analysis
    const sameStretch = phases[stage.id] === phases[ctx.state.id] && laterStates(ctx.flow.definition, stage.id, application.loanType).has(ctx.state.id)
    if (!sameStretch) fail(409, 'This part of the flow is over; the stage can no longer be reopened.', 'invalid_state')
    const why = reason(input.reason, 'Say why the stage is being reopened.')
    const { changes } = entryChanges(ctx.flow, application, stage.id, ctx.settings)
    return {
      changes: { ...changes, status: application.status === 'info_requested' ? 'info_requested' : changes.status, stageProgress: progressWithout(ctx.flow, application, stage.id) },
      event: { type: 'stage', message: `${stepName(stage)}: reopened (${why})` },
    }
  },
}

const loadSettings = async () => ({ workflow: await getSetting('workflow'), offers: await getSetting('offers'), products: await getProducts() })

/**
 * Applies one action. `input.version` must match the row, so an action taken on a stale
 * screen is refused with a prompt to refresh instead of overwriting a colleague's work.
 * Returns { application, result } where result carries hints for the handler: approved,
 * accepted, handToLms, notify, consumeOtpFor, kind.
 */
export const applyAction = async (viewer, applicationId, input, context = {}) => {
  const settings = await loadSettings()
  const db = await getDb()
  // Outside the transaction: the first call builds and backfills the workflow, and the
  // case's version is read into the cache so the transaction needs no other connection.
  await getPublishedWorkflow()
  const [current] = await db.select({ workflowVersion: applications.workflowVersion }).from(applications).where(eq(applications.id, applicationId)).limit(1)
  if (current?.workflowVersion) await getWorkflowVersion(current.workflowVersion)

  return db.transaction(async (tx) => {
    const [application] = await tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
    if (!application) fail(404, 'Application not found.', 'not_found')
    if (Number(input.version) !== application.version) {
      fail(409, 'Someone else has updated this case. Refresh to see their changes before you continue.', 'stale')
    }
    const { flow, state } = await locate(application, tx)
    const ctx = { flow, state, settings }

    let outcome
    if (UTILITY[input?.action]) {
      const { changes, event, ...hints } = await UTILITY[input.action](tx, viewer, application, input, ctx, context)
      outcome = { changes, event, result: hints }
    } else {
      if (state.type === 'final') fail(409, 'This case is closed.', 'invalid_state')
      const action = input?.action === 'transition' ? (state.actions || []).find((entry) => entry.id === input.actionId) : resolveLegacyAction(flow, state, application, input)
      if (!action && input?.action !== 'transition') fail(400, 'Unknown action.', 'invalid_input')
      outcome = await runTransition(tx, viewer, application, flow, state, action, input, settings)
    }

    const { changes, event, result } = outcome
    const [updated] = await tx
      .update(applications)
      .set({ ...changes, version: application.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.version, application.version)))
      .returning()
    if (!updated) fail(409, 'Someone else has updated this case. Refresh and try again.', 'stale')

    const { customerMessage, ...entry } = event
    const moved = updated.state !== application.state
    await addEvent(tx, {
      applicationId: application.id,
      actor: viewer,
      fromStatus: updated.status !== application.status ? application.status : null,
      toStatus: updated.status !== application.status ? updated.status : null,
      ...entry,
      detail: { ...(customerMessage ? { customerMessage } : {}), ...(moved ? { fromState: application.state, toState: updated.state } : {}) },
    })
    return { application: updated, result }
  })
}

/**
 * A move the system makes rather than a person's action: the customer accepting,
 * replying or withdrawing, an offer lapsing, the LMS reporting a payout, the rules
 * declining. Guarded by the row's version (and optionally its state), so it can't
 * overwrite a change made meanwhile. Returns the updated row, or null when it lost.
 */
export const systemTransition = async (db, application, targetId, { changes = {}, event, actor = null, expectState, settings } = {}) => {
  if (expectState && application.state !== expectState) return null
  const flow = await getWorkflowVersion(application.workflowVersion, db)
  // Only the offer state needs the settings (its deadline); system moves never go there,
  // and `db` may be a transaction, so they are not read unless given.
  const { target, changes: entry } = entryChanges(flow, application, targetId, settings)
  const [updated] = await db
    .update(applications)
    .set({ ...entry, ...changes, version: application.version + 1, updatedAt: new Date() })
    .where(and(eq(applications.id, application.id), eq(applications.version, application.version)))
    .returning()
  if (!updated) return null
  const { customerMessage, ...entryEvent } = event
  await addEvent(db, {
    applicationId: application.id,
    actor,
    fromStatus: updated.status !== application.status ? application.status : null,
    toStatus: updated.status !== application.status ? updated.status : null,
    ...entryEvent,
    detail: { ...(customerMessage ? { customerMessage } : {}), fromState: application.state, toState: updated.state },
  })
  return { application: updated, target }
}

/** Where a case waiting in `application.state` goes, by what happened: the workflow's own ends and the offer's next step. */
export const stateAfter = async (application, what) => {
  const { flow, state } = await locate(application)
  if (what === 'accepted') return state.type === 'offer' ? state.offer.onAccept : null
  return { declined: 'declined', withdrawn: 'withdrawn', expired: 'expired', paid_out: 'paid_out' }[what] || null
}

/** The case's state, workflow and analysis, for handlers deciding what applies. */
export const caseWorkflow = locate

// ---------------------------------------------------------------------------
// What the case page shows
// ---------------------------------------------------------------------------

/** Why `viewer` can't take `action` here, or null when they can (the server checks again on the day). */
const blockedReason = (viewer, application, state, action, recommendation, roleName) => {
  if (application.status === 'info_requested') return 'Waiting on the applicant.'
  if (viewer.role !== 'admin') {
    const roles = state.roles || []
    if (roles.length && !roles.includes(viewer.role)) return `Waiting for ${roles.map((role) => roleName(role).toLowerCase()).join(' or ')}.`
    if (!viewer.permissions?.includes(actionPermission(action))) return 'Your role can’t do this.'
  }
  if (action.options?.fourEyes && (recommendation?.officerId === viewer.id || application.sourcedBy === viewer.id)) {
    return recommendation?.officerId === viewer.id ? 'You recommended this case, so a colleague makes the decision.' : 'You brought this case in, so a colleague makes the decision.'
  }
  return null
}

/**
 * The case's place in its workflow, for the case page: its state, the recorded steps of
 * the journey, and each action there with whether this viewer may take it.
 */
export const workflowView = async (viewer, application, { recommendation = null } = {}) => {
  const { flow, state } = await locate(application)
  const { definition, analysis } = flow
  const product = application.loanType
  const labels = Object.fromEntries((await listRoles()).map((role) => [role.key, role.label]))
  const roleName = (key) => labels[key] || key
  const phase = analysis.phases[state.id] || null
  const stepStates = analysis.order.map((id) => stateById(definition, id)).filter((entry) => entry?.trackProgress && appliesTo(entry, product))
  const currentStretch = new Set([state.id, ...laterStates(definition, state.id, product)])
  return {
    version: flow.version,
    legacy: flow.legacy,
    checklist: definition.checklist || [],
    state: {
      id: state.id,
      label: state.label,
      stepName: stepName(state),
      description: state.description || '',
      type: state.type,
      roles: state.roles || [],
      askApplicant: Boolean(state.askApplicant),
      trackProgress: Boolean(state.trackProgress),
      requiredChecks: state.requiredChecks || [],
      checks: [...new Set([...(state.requiredChecks || []), ...(state.actions || []).flatMap((action) => action.options?.checks || [])])],
      onAcceptLabel: state.type === 'offer' ? resolveState(definition, state.offer?.onAccept, product)?.label || null : null,
    },
    phase,
    worksHere: worksOn(viewer, state),
    steps: stepStates.map((entry) => ({
      id: entry.id,
      label: stepName(entry),
      description: entry.description || '',
      phase: analysis.phases[entry.id],
      roles: entry.roles || [],
      checks: entry.requiredChecks || [],
      current: entry.id === state.id,
      progress: application.stageProgress?.[entry.id] || null,
      // Done steps in the stretch still ahead of the case's current position can be reopened.
      reopenable: Boolean(application.stageProgress?.[entry.id]?.done) && analysis.phases[entry.id] === phase && !currentStretch.has(entry.id),
      moveActionId: moveOf(entry)?.id || null,
    })),
    actions:
      state.type === 'final'
        ? []
        : (state.actions || []).map((action) => {
            const target = actionTarget(definition, action, product)
            return {
              id: action.id,
              label: action.label,
              kind: action.kind,
              tone: ACTION_KINDS[action.kind]?.tone || 'neutral',
              to: target?.id || action.to,
              toLabel: target?.label || action.to,
              singleStep: Boolean(action.options?.singleStep),
              claim: Boolean(action.options?.claim),
              requireNote: Boolean(action.options?.requireNote),
              checks: action.options?.checks || [],
              blocked: blockedReason(viewer, application, state, action, recommendation, roleName),
            }
          }),
  }
}
