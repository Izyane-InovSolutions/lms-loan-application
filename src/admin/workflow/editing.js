import { ACTION_KINDS, SYSTEM_FINAL_IDS, stateById } from '@/config/workflow'

/*
 * Pure edits on a workflow definition (src/config/workflow.js), for the Workflow editor.
 * Each returns a new definition; ids are made from names and kept once made, so a case's
 * state keeps its meaning when a state is renamed.
 */

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

const uniqueId = (wanted, taken, fallback) => {
  const base = slug(wanted) || fallback
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`
  return id
}

/** A definition as the editor works on it: without the markers the old settings' versions carry. */
export const forEditing = (definition) => ({
  start: definition.start,
  checklist: (definition.checklist || []).map((check) => ({ ...check })),
  states: (definition.states || []).map(({ legacyStatus: _legacyStatus, ...state }) => ({
    roles: [],
    products: [],
    requiredChecks: [],
    askApplicant: false,
    handToLms: false,
    trackProgress: false,
    description: '',
    ...state,
    actions: (state.actions || []).map((action) => ({ ...action, options: { checks: [], ...(action.options || {}) } })),
  })),
})

const withStates = (definition, states) => ({ ...definition, states })

const updateState = (definition, id, change) => withStates(definition, definition.states.map((state) => (state.id === id ? { ...state, ...change(state) } : state)))

/** The usual name for an action of `kind` leading to `target`. */
export const defaultActionLabel = (kind, target) =>
  ({ move: `Send to ${target?.label || '…'}`, return: 'Return', recommend: 'Recommend', approve: 'Approve', reject: 'Reject', pay_out: 'Mark as paid out' })[kind] || 'Continue'

/** A new in-progress state, placed before the built-in ends (or after `afterId`). */
export const addState = (definition, { label = 'New state', type = 'work', afterId = null } = {}) => {
  const id = uniqueId(label, new Set(definition.states.map((state) => state.id)), 'state')
  const state = { id, label, type, description: '', roles: [], products: [], requiredChecks: [], askApplicant: false, handToLms: false, trackProgress: false, actions: [], ...(type === 'offer' ? { offer: { onAccept: '' } } : {}) }
  const states = [...definition.states]
  const after = afterId ? states.findIndex((entry) => entry.id === afterId) : -1
  const firstFinal = states.findIndex((entry) => entry.type === 'final')
  const at = after >= 0 ? after + 1 : firstFinal >= 0 ? firstFinal : states.length
  states.splice(at, 0, state)
  return { definition: withStates(definition, states), id }
}

export const changeState = (definition, id, changes) => updateState(definition, id, () => changes)

/** Removes a state, and every action and acceptance that led to it. The built-in ends stay. */
export const removeState = (definition, id) => {
  if (SYSTEM_FINAL_IDS.includes(id)) return definition
  const states = definition.states
    .filter((state) => state.id !== id)
    .map((state) => ({
      ...state,
      actions: (state.actions || []).filter((action) => action.to !== id),
      ...(state.offer?.onAccept === id ? { offer: { ...state.offer, onAccept: '' } } : {}),
    }))
  return { ...definition, states, start: definition.start === id ? states.find((state) => state.type === 'work')?.id || '' : definition.start }
}

/** Puts `id` just before `beforeId` (or last, with no `beforeId`). */
export const moveStateBefore = (definition, id, beforeId) => {
  if (id === beforeId) return definition
  const moving = stateById(definition, id)
  const rest = definition.states.filter((state) => state.id !== id)
  const at = beforeId ? rest.findIndex((state) => state.id === beforeId) : rest.length
  rest.splice(at < 0 ? rest.length : at, 0, moving)
  return withStates(definition, rest)
}

/** Adds an action to `stateId`; the kind's fixed target (Reject, Mark as paid out) wins. */
export const addAction = (definition, stateId, { kind = 'move', to = '', label } = {}) => {
  const state = stateById(definition, stateId)
  const target = ACTION_KINDS[kind]?.to || to
  const id = uniqueId(label || kind, new Set((state.actions || []).map((action) => action.id)), 'action')
  const action = { id, label: label || defaultActionLabel(kind, stateById(definition, target)), kind, to: target, options: { checks: [] } }
  return { definition: updateState(definition, stateId, (current) => ({ actions: [...(current.actions || []), action] })), actionId: id }
}

export const changeAction = (definition, stateId, actionId, changes) =>
  updateState(definition, stateId, (state) => ({
    actions: state.actions.map((action) => {
      if (action.id !== actionId) return action
      const next = { ...action, ...changes, options: { ...action.options, ...(changes.options || {}) } }
      // Changing the kind moves Reject / Paid out actions to their fixed ends.
      if (changes.kind && ACTION_KINDS[changes.kind]?.to) next.to = ACTION_KINDS[changes.kind].to
      return next
    }),
  }))

export const removeAction = (definition, stateId, actionId) => updateState(definition, stateId, (state) => ({ actions: state.actions.filter((action) => action.id !== actionId) }))

/**
 * Connects `fromId` to `toId` by dragging: a Move, or the acceptance when `fromId` is the
 * offer. Nothing changes when they are already connected, or for an end.
 */
export const connect = (definition, fromId, toId) => {
  const from = stateById(definition, fromId)
  const to = stateById(definition, toId)
  if (!from || !to || from.id === to.id || from.type === 'final') return { definition, actionId: null }
  if (from.type === 'offer') return { definition: changeState(definition, fromId, { offer: { ...from.offer, onAccept: toId } }), actionId: null }
  if ((from.actions || []).some((action) => action.to === toId)) return { definition, actionId: null }
  const kind = toId === 'declined' ? 'reject' : toId === 'paid_out' ? 'pay_out' : 'move'
  return addAction(definition, fromId, { kind, to: toId })
}

/** Creates a state from a drag onto empty space, connected from `fromId`. */
export const connectToNew = (definition, fromId) => {
  const created = addState(definition, { label: 'New state', afterId: fromId })
  const connected = connect(created.definition, fromId, created.id)
  return { definition: connected.definition, id: created.id }
}

/** The workflow's checklist, edited as a whole. */
export const changeChecklist = (definition, checklist) => {
  const taken = new Set()
  const items = checklist.map((check) => {
    const key = check.key && !taken.has(check.key) ? check.key : uniqueId(check.label, taken, 'check')
    taken.add(key)
    return { ...check, key }
  })
  const known = new Set(items.map((check) => check.key))
  // Checks that no longer exist drop out of the states and actions that needed them.
  const states = definition.states.map((state) => ({
    ...state,
    requiredChecks: (state.requiredChecks || []).filter((key) => known.has(key)),
    actions: (state.actions || []).map((action) => ({ ...action, options: { ...action.options, checks: (action.options?.checks || []).filter((key) => known.has(key)) } })),
  }))
  return { ...definition, checklist: items, states }
}
