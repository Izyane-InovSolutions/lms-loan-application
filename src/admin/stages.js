/*
 * The stages Applications and the Pipeline show: Draft (unfinished applications), then the
 * published workflow's in-progress states in the order a case moves, then its ends. Only
 * what the workflow has is shown (Workflow editor); a state turned off appears only while
 * cases are still in it, and states of earlier versions only while open cases are on them.
 */

export const DRAFT_STAGE = { key: 'draft', label: 'Draft' }

/** The workflow's in-progress states, in order: [{ id, label, category, disabled }]. */
export const workStages = (workflow) => {
  const current = workflow?.current
  if (!current) return []
  const byId = Object.fromEntries(current.states.map((state) => [state.id, state]))
  return current.order
    .filter((id) => byId[id] && byId[id].type !== 'final')
    .map((id) => ({ id, label: byId[id].label, category: current.categories[id], disabled: Boolean(byId[id].disabled) }))
}

/** In-progress states of older versions that the current one no longer has. */
export const retiredStages = (workflow) => {
  const known = new Set((workflow?.current?.states || []).map((state) => state.id))
  const retired = new Map()
  for (const version of workflow?.versions || []) {
    for (const state of version.states) {
      if (!known.has(state.id) && state.type !== 'final' && !retired.has(state.id)) retired.set(state.id, { id: state.id, label: `${state.label} (earlier workflow)`, category: version.categories[state.id], retired: true })
    }
  }
  return [...retired.values()]
}

/** The workflow's ends: [{ id, label }]. */
export const endStages = (workflow) => (workflow?.current?.states || []).filter((state) => state.type === 'final').map((state) => ({ id: state.id, label: state.label }))

/** What a case's stage is called: the state's name now, else (a state only older versions have) its name in its own version. */
export const stageLabel = (workflow, row) => {
  const versions = [workflow?.current, ...(workflow?.versions || [])].filter(Boolean)
  const own = versions.find((version) => version.version === row.workflowVersion)
  const named = (version) => version?.states.find((state) => state.id === row.state)?.label
  return named(workflow?.current) || named(own) || versions.map(named).find(Boolean) || null
}
