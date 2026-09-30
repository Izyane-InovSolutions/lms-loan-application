/**
 * The loan workflow as the workspace configures it (Workflow editor): the states an
 * application moves through, who works on each, and the actions that move it on. Shared
 * by the API, which enforces it, and the workspace, which edits and shows it.
 *
 * A workflow definition:
 *
 *   { start, checklist: [{ key, label, hint, requiredToApprove }],
 *     states: [{ id, label, type: 'work' | 'offer' | 'final', outcome?,
 *                roles, products, requiredChecks, askApplicant, handToLms, trackProgress,
 *                offer?: { onAccept }, actions: [{ id, label, kind, to, permission?, options }] }] }
 *
 * `applications.status` stays the reporting category every report, the customer page and
 * the LMS read. It is derived from the state (analyzeWorkflow → categories): the graph
 * decides whether a state comes before the decision, after it, or after the customer
 * accepted, and that fixes its category.
 */

import { APPLICATION_STATUSES } from './applications.js'
import { DEFAULT_CHECKLIST } from './stages.js'

export const STATE_TYPES = {
  work: { label: 'In progress' },
  offer: { label: 'Offer' },
  final: { label: 'Final' },
}

/**
 * The ends every workflow has, with fixed ids so the system can always reach them: a
 * decline, the customer withdrawing, an offer lapsing, the LMS reporting a payout. They
 * can be renamed but not removed.
 */
export const SYSTEM_FINALS = {
  paid_out: { outcome: 'disbursed', label: 'Paid out' },
  declined: { outcome: 'declined', label: 'Declined' },
  withdrawn: { outcome: 'withdrawn', label: 'Withdrawn' },
  expired: { outcome: 'expired', label: 'Offer expired' },
}
export const SYSTEM_FINAL_IDS = Object.keys(SYSTEM_FINALS)

/**
 * What an action does. `permission` is who may do it unless the state names roles (which
 * then narrow it); `forward` actions move the case on and must never loop back; `to`
 * fixes the target for the kinds that always end in the same place.
 */
export const ACTION_KINDS = {
  move: { label: 'Move on', tone: 'forward', permission: 'cases.work', forward: true },
  return: { label: 'Send back', tone: 'neutral', permission: 'cases.work', forward: false },
  recommend: { label: 'Recommend', tone: 'forward', permission: 'cases.recommend', forward: true },
  approve: { label: 'Approve', tone: 'forward', permission: 'cases.decide', forward: true },
  reject: { label: 'Reject', tone: 'danger', permission: 'cases.decide', forward: true, to: 'declined' },
  pay_out: { label: 'Mark as paid out', tone: 'forward', permission: 'cases.disburse', forward: true, to: 'paid_out' },
}

/** Where a case is in the journey: before the decision, approved (awaiting acceptance), or accepted. */
export const PHASES = { review: 'Before the decision', decided: 'After approval', accepted: 'After the customer accepts' }

export const stateById = (definition, id) => (definition?.states || []).find((state) => state.id === id) || null

/** Whether a state applies to a product; a state limited to others is skipped. */
export const appliesTo = (state, product) => !state?.products?.length || !product || state.products.includes(product)

/** The edges that move a case on, including an offer's acceptance. */
export const forwardEdges = (state) => [
  ...(state?.actions || []).filter((action) => ACTION_KINDS[action.kind]?.forward).map((action) => ({ to: action.to, kind: action.kind, actionId: action.id })),
  ...(state?.type === 'offer' && state.offer?.onAccept ? [{ to: state.offer.onAccept, kind: 'accept', actionId: null }] : []),
]

/**
 * The state a case really lands in when sent to `id`: a state limited to other products
 * is passed through by its single move, as if it weren't there.
 */
export const resolveState = (definition, id, product) => {
  const seen = new Set()
  let state = stateById(definition, id)
  while (state && !appliesTo(state, product) && !seen.has(state.id)) {
    seen.add(state.id)
    const skip = (state.actions || []).find((action) => action.kind === 'move')
    state = skip ? stateById(definition, skip.to) : null
  }
  return state
}

const PRODUCTS = ['personal', 'business']

/**
 * Walks the graph from the start, once per product, and works out each state's phase and
 * reporting category. Returns { phases, categories, order, problems } where problems are
 * the graph errors (cycles, phase conflicts, …) validateWorkflow reports.
 */
export const analyzeWorkflow = (definition) => {
  const states = definition?.states || []
  const problems = []
  const seenPhases = {}
  const recommended = {}
  const reached = new Set()

  // Cycles among forward edges, whatever the product: a case must always make progress.
  const colour = {}
  const order = []
  const visit = (id, trail) => {
    if (colour[id] === 'done') return
    if (colour[id] === 'active') {
      const loop = trail.slice(trail.indexOf(id)).map((entry) => stateById(definition, entry)?.label || entry)
      problems.push({ stateId: id, message: `These states loop back on each other: ${[...loop, loop[0]].join(' → ')}. Use a Return action to send a case back.` })
      return
    }
    const state = stateById(definition, id)
    if (!state) return
    colour[id] = 'active'
    forwardEdges(state).forEach((edge) => visit(edge.to, [...trail, id]))
    colour[id] = 'done'
    order.unshift(id)
  }
  if (definition?.start) visit(definition.start, [])
  states.forEach((state) => visit(state.id, []))
  const hasCycle = problems.length > 0

  if (!hasCycle) {
    for (const product of PRODUCTS) {
      const walk = (id, phase, afterRecommend, path) => {
        const state = resolveState(definition, id, product)
        if (!state || path.has(state.id)) return
        reached.add(state.id)
        if (state.type === 'final') return
        seenPhases[state.id] = seenPhases[state.id] || new Set()
        seenPhases[state.id].add(phase)
        recommended[state.id] = recommended[state.id] || new Set()
        recommended[state.id].add(afterRecommend)
        const nextPath = new Set(path).add(state.id)
        forwardEdges(state).forEach((edge) => {
          const next =
            edge.kind === 'approve'
              ? ['decided', false]
              : edge.kind === 'accept'
                ? ['accepted', false]
                : edge.kind === 'recommend'
                  ? [phase, true]
                  : [phase, afterRecommend]
          walk(edge.to, next[0], next[1], nextPath)
        })
      }
      if (definition?.start) walk(definition.start, 'review', false, new Set())
    }
  }

  const phases = {}
  const categories = {}
  for (const state of states) {
    if (state.type === 'final') {
      categories[state.id] = SYSTEM_FINALS[state.id]?.outcome || state.outcome || 'declined'
      continue
    }
    const seen = [...(seenPhases[state.id] || [])]
    if (seen.length > 1) {
      problems.push({ stateId: state.id, message: `“${state.label}” can be reached both ${seen.map((phase) => PHASES[phase].toLowerCase()).join(' and ')}. A state belongs to one part of the journey.` })
    }
    const phase = seen[0] || 'review'
    phases[state.id] = phase
    if (phase === 'review') {
      const afterRecommend = recommended[state.id]
      categories[state.id] =
        state.id === definition.start ? 'submitted' : afterRecommend?.size === 1 && afterRecommend.has(true) ? 'pending_approval' : 'in_review'
    } else if (phase === 'decided') {
      categories[state.id] = 'approved'
    } else {
      categories[state.id] = 'accepted'
    }
  }

  // Pipeline order: forward order from the start, then anything unreachable, finals last.
  const finalsLast = [...order.filter((id) => stateById(definition, id)?.type !== 'final'), ...order.filter((id) => stateById(definition, id)?.type === 'final')]
  return { phases, categories, order: finalsLast, reached, problems, hasCycle }
}

/** Every state the forward edges can reach from `id` (not counting `id` itself). */
const reachableFrom = (definition, id) => {
  const found = new Set()
  const stack = [id]
  while (stack.length) {
    const state = stateById(definition, stack.pop())
    for (const edge of forwardEdges(state)) {
      if (!found.has(edge.to)) {
        found.add(edge.to)
        stack.push(edge.to)
      }
    }
  }
  return found
}

/**
 * Checks a workflow before it is published (and live in the editor). Returns
 * { errors, warnings, phases, categories, order }; each message may carry the stateId
 * and actionId it is about. `roles` is the list of role keys that exist.
 */
export const validateWorkflow = (definition, { roles } = {}) => {
  const errors = []
  const warnings = []
  const states = Array.isArray(definition?.states) ? definition.states : []
  const add = (list, message, stateId = null, actionId = null) => list.push({ message, stateId, actionId })

  if (!states.length) {
    add(errors, 'The workflow has no states.')
    return { errors, warnings, phases: {}, categories: {}, order: [] }
  }

  const ids = new Set()
  for (const state of states) {
    if (!state.id) add(errors, 'A state has no id.')
    else if (ids.has(state.id)) add(errors, `Two states share the id “${state.id}”.`, state.id)
    ids.add(state.id)
    if (String(state.label || '').trim().length < 2) add(errors, 'Every state needs a name.', state.id)
    if (!STATE_TYPES[state.type]) add(errors, `“${state.label}” has an unknown type.`, state.id)
  }

  for (const [id, meta] of Object.entries(SYSTEM_FINALS)) {
    const state = stateById(definition, id)
    if (!state) add(errors, `The “${meta.label}” end is missing. Every workflow keeps it.`)
    else if (state.type !== 'final') add(errors, `“${state.label}” must stay a final state.`, id)
  }
  for (const state of states.filter((entry) => entry.type === 'final' && !SYSTEM_FINALS[entry.id])) {
    add(errors, `“${state.label}”: only the built-in ends can be final. Rename one of them instead.`, state.id)
  }

  const start = stateById(definition, definition.start)
  if (!start) add(errors, 'Choose the state new applications start in.')
  else {
    if (start.type !== 'work') add(errors, 'New applications must start in an in-progress state.', start.id)
    if (start.products?.length) add(errors, 'The start state must apply to every loan product.', start.id)
  }

  const checkKeys = new Set((definition.checklist || []).map((check) => check.key))
  const roleKeys = roles ? new Set(roles) : null
  const offers = states.filter((state) => state.type === 'offer')

  for (const state of states) {
    if (state.type === 'final') {
      if (state.actions?.length) add(errors, `“${state.label}” is an end: it can’t have actions.`, state.id)
      if (state.products?.length) add(errors, `“${state.label}” is an end and applies to every product.`, state.id)
      continue
    }
    const actions = state.actions || []
    const actionIds = new Set()
    for (const action of actions) {
      const kind = ACTION_KINDS[action.kind]
      if (!action.id || actionIds.has(action.id)) add(errors, `“${state.label}” has two actions with the same id.`, state.id, action.id)
      actionIds.add(action.id)
      if (!kind) {
        add(errors, `“${state.label}” has an action of an unknown kind.`, state.id, action.id)
        continue
      }
      if (String(action.label || '').trim().length < 2) add(errors, `An action in “${state.label}” needs a name.`, state.id, action.id)
      const target = stateById(definition, action.to)
      if (!target) {
        add(errors, `“${action.label || kind.label}” in “${state.label}” goes nowhere. Choose where it sends the case.`, state.id, action.id)
        continue
      }
      if (kind.to && action.to !== kind.to) add(errors, `“${action.label}” must lead to “${stateById(definition, kind.to)?.label || kind.to}”.`, state.id, action.id)
      if (!kind.to && target.type === 'final') add(errors, `“${action.label}” can’t end the case. Use a Reject or Mark as paid out action for that.`, state.id, action.id)
      if (target.id === state.id) add(errors, `“${action.label}” in “${state.label}” leads back to the same state.`, state.id, action.id)
      for (const key of action.options?.checks || []) {
        if (!checkKeys.has(key)) add(errors, `“${action.label}” needs a checklist item that no longer exists.`, state.id, action.id)
      }
    }
    for (const key of state.requiredChecks || []) {
      if (!checkKeys.has(key)) add(errors, `“${state.label}” needs a checklist item that no longer exists.`, state.id)
    }
    if (roleKeys) {
      for (const role of state.roles || []) {
        if (!roleKeys.has(role)) add(warnings, `“${state.label}” names a role that no longer exists; anyone with the permission can act.`, state.id)
      }
    }
    if (!forwardEdges(state).length) add(errors, `“${state.label}” has no way forward. Add an action that moves the case on.`, state.id)
    if (state.type === 'offer') {
      const onAccept = stateById(definition, state.offer?.onAccept)
      if (!onAccept) add(errors, `“${state.label}”: choose where a case goes once the customer accepts.`, state.id)
      else if (onAccept.type !== 'work') add(errors, `“${state.label}”: after acceptance a case goes to an in-progress state (payout comes from there).`, state.id)
    }
    if (state.products?.length && state.products.length < PRODUCTS.length && actions.filter((action) => action.kind === 'move').length !== 1) {
      add(errors, `“${state.label}” is for some loans only, so it needs exactly one Move action: the way other loans go past it.`, state.id)
    }
  }
  if (offers.length > 1) add(errors, 'A workflow can have one offer state.', offers[1].id)

  const analysis = analyzeWorkflow(definition)
  analysis.problems.forEach((problem) => add(errors, problem.message, problem.stateId))

  if (!analysis.hasCycle) {
    for (const state of states) {
      if (state.type === 'final') continue
      const phase = analysis.phases[state.id]
      if (!analysis.reached.has(state.id)) add(errors, `“${state.label}” can’t be reached from the start.`, state.id)
      for (const action of state.actions || []) {
        const target = stateById(definition, action.to)
        if (!target) continue
        if (action.kind === 'recommend' && phase !== 'review') add(errors, `“${action.label}”: a recommendation belongs before the decision.`, state.id, action.id)
        if (action.kind === 'approve' && phase !== 'review') add(errors, `“${action.label}”: the case is already approved here.`, state.id, action.id)
        if (action.kind === 'reject' && phase !== 'review') add(errors, `“${action.label}”: after approval a case is withdrawn, not rejected.`, state.id, action.id)
        if (action.kind === 'pay_out' && phase === 'review') add(errors, `“${action.label}”: a loan is paid out only after it is approved.`, state.id, action.id)
        if (action.kind === 'return') {
          if (!reachableFrom(definition, target.id).has(state.id)) add(errors, `“${action.label}” must send the case back to an earlier state.`, state.id, action.id)
          else if (analysis.phases[target.id] !== phase) add(errors, `“${action.label}” can’t go back past the decision: the offer, signatures and LMS hand-off can’t be undone.`, state.id, action.id)
        }
      }
      if (state.type === 'offer' && phase !== 'decided') add(errors, `“${state.label}” must come right after an Approve action.`, state.id)
      if (state.askApplicant && phase !== 'review') add(errors, `“${state.label}”: the applicant can only be asked for more before the decision.`, state.id)
    }
  }

  return { errors, warnings, phases: analysis.phases, categories: analysis.categories, order: analysis.order }
}

/** The reporting status of a case in `stateId`: the category, or info_requested while it waits on the applicant. */
export const categoryOf = (analysis, stateId, { infoRequested = false } = {}) => (infoRequested ? 'info_requested' : analysis.categories[stateId] || null)

// ---------------------------------------------------------------------------
// Today's settings as a workflow (v1)
// ---------------------------------------------------------------------------

const PHASE_PERMISSIONS = { review: 'cases.work', approval: 'cases.decide', closing: 'cases.disburse' }

/**
 * The workflow the old settings describe — Settings → Credit workflow (four-eyes), offers
 * (acceptance), the LMS moment, and the stages in each phase — so turning the workflow on
 * changes nothing. State ids match the statuses and stage ids they stand for, so cases
 * map across (legacyStateOf) and a case's recorded stage progress keeps its meaning.
 */
export const legacyToWorkflow = ({ workflow = {}, offers = {}, lms = {}, stages = {} } = {}) => {
  const renamed = stages.labels || {}
  const name = (status, fallback) => (renamed[status] || '').trim() || fallback || APPLICATION_STATUSES[status].label
  const products = (stage) => (stage.products?.length ? stage.products : [])
  const review = stages.review || []
  const approval = stages.approval || []
  const closing = stages.closing || []
  const requireAcceptance = offers.requireAcceptance !== false
  const twoStep = workflow.requireSecondApproval !== false || approval.length > 0
  const fourEyes = workflow.requireSecondApproval !== false
  const requiredToApprove = (stages.checklist || DEFAULT_CHECKLIST).filter((check) => check.requiredToApprove).map((check) => check.key)

  const reviewName = name('in_review')
  const approvalName = name('pending_approval')
  const closingStatus = requireAcceptance ? 'accepted' : 'approved'
  const closingName = requireAcceptance ? name('accepted') : name('approved', 'Approved')
  const readyId = requireAcceptance ? 'accepted' : 'approved'
  const afterDecision = requireAcceptance ? 'approved' : closing[0]?.id || readyId

  const stageState = (stage, base, legacyStatus, next, permission, extra = {}) => ({
    id: stage.id,
    label: `${base}: ${stage.label}`,
    description: stage.description || '',
    type: 'work',
    roles: stage.roles || [],
    products: products(stage),
    requiredChecks: stage.checks || [],
    askApplicant: legacyStatus === 'in_review',
    handToLms: false,
    trackProgress: true,
    legacyStatus,
    actions: [{ id: 'done', label: 'Mark as done', kind: 'move', to: next, permission, options: extra }],
  })

  const states = [
    {
      id: 'submitted',
      label: name('submitted', 'New'),
      type: 'work',
      roles: [],
      products: [],
      askApplicant: true,
      handToLms: lms.syncOn === 'submit',
      legacyStatus: 'submitted',
      actions: [{ id: 'start_review', label: 'Start review', kind: 'move', to: review[0]?.id || 'in_review', options: { claim: true } }],
    },
    ...review.map((stage, index) => stageState(stage, reviewName, 'in_review', review[index + 1]?.id || 'in_review', PHASE_PERMISSIONS.review)),
    {
      id: 'in_review',
      label: review.length ? `${reviewName}: ready to recommend` : reviewName,
      type: 'work',
      roles: [],
      products: [],
      askApplicant: true,
      legacyStatus: 'in_review',
      actions: twoStep
        ? [{ id: 'recommend', label: 'Recommend', kind: 'recommend', to: approval[0]?.id || 'pending_approval', options: { checks: requiredToApprove } }]
        : [
            // Four-eyes off: the officer's recommendation is the decision, recorded as such.
            { id: 'approve', label: 'Approve', kind: 'approve', to: afterDecision, permission: 'cases.recommend', options: { checks: requiredToApprove, singleStep: true } },
            { id: 'reject', label: 'Decline', kind: 'reject', to: 'declined', permission: 'cases.recommend', options: { singleStep: true } },
          ],
    },
    ...(twoStep
      ? [
          ...approval.map((stage, index) =>
            stageState(stage, approvalName, 'pending_approval', approval[index + 1]?.id || 'pending_approval', PHASE_PERMISSIONS.approval, { fourEyes: stage.differentPerson !== false })
          ),
          {
            id: 'pending_approval',
            label: approval.length ? `${approvalName}: ready for a decision` : approvalName,
            type: 'work',
            roles: [],
            products: [],
            legacyStatus: 'pending_approval',
            actions: [
              { id: 'approve', label: 'Approve', kind: 'approve', to: afterDecision, options: { fourEyes } },
              { id: 'reject', label: 'Decline', kind: 'reject', to: 'declined', options: { fourEyes } },
              { id: 'return', label: 'Send back', kind: 'return', to: 'in_review', permission: 'cases.decide', options: { fourEyes, requireNote: true } },
            ],
          },
        ]
      : []),
    ...(requireAcceptance
      ? [{ id: 'approved', label: name('approved', 'Offer made'), type: 'offer', roles: [], products: [], legacyStatus: 'approved', offer: { onAccept: closing[0]?.id || readyId }, actions: [] }]
      : []),
    ...closing.map((stage, index) => stageState(stage, closingName, closingStatus, closing[index + 1]?.id || readyId, PHASE_PERMISSIONS.closing)),
    {
      id: readyId,
      label: closing.length ? `${closingName}: ready to pay out` : closingName,
      type: 'work',
      roles: [],
      products: [],
      handToLms: lms.syncOn !== 'submit',
      legacyStatus: closingStatus,
      actions: [{ id: 'pay_out', label: 'Mark as paid out', kind: 'pay_out', to: 'paid_out' }],
    },
    ...SYSTEM_FINAL_IDS.map((id) => ({
      id,
      label: name(SYSTEM_FINALS[id].outcome, SYSTEM_FINALS[id].label),
      type: 'final',
      roles: [],
      products: [],
      legacyStatus: SYSTEM_FINALS[id].outcome,
      actions: [],
    })),
  ]

  return { start: 'submitted', checklist: stages.checklist || DEFAULT_CHECKLIST, states, legacy: true }
}

/**
 * The v1 state a case is in, from its status and the stages it has done. `fromStatus` is
 * where a case waiting on the applicant was before (its last status event).
 */
export const legacyStateOf = (definition, application, { fromStatus } = {}) => {
  const status = application.status === 'info_requested' ? fromStatus || 'in_review' : application.status
  const finals = { disbursed: 'paid_out', declined: 'declined', withdrawn: 'withdrawn', expired: 'expired' }
  if (finals[status]) return finals[status]
  const candidates = (definition.states || []).filter((state) => state.legacyStatus === status)
  const pending = candidates.find((state) => state.trackProgress && appliesTo(state, application.loanType) && !application.stageProgress?.[state.id]?.done)
  if (pending) return pending.id
  const ready = candidates.find((state) => !state.trackProgress)
  return ready?.id || definition.start
}
