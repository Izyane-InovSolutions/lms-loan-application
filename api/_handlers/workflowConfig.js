import { and, eq, ne, notInArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { listRoles } from '../_lib/roles.js'
import { listDocumentKinds } from '../_lib/templates.js'
import {
  discardDraftWorkflow,
  getDraftWorkflow,
  getPublishedWorkflow,
  getWorkflowVersion,
  listWorkflowHistory,
  publishDraftWorkflow,
  saveDraftWorkflow,
} from '../_lib/workflowVersions.js'
import { ACTION_KINDS, STATE_TYPES, SYSTEM_FINAL_IDS, stateById, validateWorkflow } from '../../src/config/workflow.js'
import { PERMISSIONS } from '../../src/config/roles.js'

const { applications } = schema

/*
 * The workflow as the workspace reads it (the pipeline, queues, the case page's labels),
 * and the Workflow editor's endpoints: the draft, publishing, history, and moving open
 * cases onto the latest version.
 */

/** What the workspace needs of one version: its states in order and their categories. */
const summarize = (flow) => ({
  version: flow.version,
  legacy: flow.legacy,
  start: flow.definition.start,
  states: flow.definition.states.map(({ id, label, type, roles = [], products = [], askApplicant = false, trackProgress = false, disabled = false }) => ({ id, label, type, roles, products, askApplicant, trackProgress, disabled })),
  order: flow.analysis.order,
  categories: flow.analysis.categories,
  phases: flow.analysis.phases,
})

/** The published workflow, and every older version open cases are still on. */
const workflowForStaff = async (req) => {
  await requireUser(req, { staff: true })
  const current = await getPublishedWorkflow()
  const db = await getDb()
  const rows = await db
    .select({ version: applications.workflowVersion, count: sql`count(*)::int` })
    .from(applications)
    .where(notInArray(applications.state, SYSTEM_FINAL_IDS))
    .groupBy(applications.workflowVersion)
  const older = rows.map((row) => row.version).filter((version) => version && version !== current.version)
  const versions = await Promise.all(older.map((version) => getWorkflowVersion(version)))
  return { current: summarize(current), versions: versions.map(summarize) }
}


// ---------------------------------------------------------------------------
// The Workflow editor (settings.manage)
// ---------------------------------------------------------------------------

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
  taken.add(id)
  return id
}

const MAX_STATES = 40
const MAX_ACTIONS = 12
const MAX_CHECKS = 30
const MAX_DOCUMENTS = 10
const PRODUCTS = ['personal', 'business']

/**
 * A definition from the editor, reduced to the fields the workflow has, with safe ids and
 * capped text. Shape only: whether it makes sense is validateWorkflow's job.
 */
export const sanitizeWorkflow = (input) => {
  const checkKeys = new Set()
  const checklist = (Array.isArray(input?.checklist) ? input.checklist : []).slice(0, MAX_CHECKS).map((check) => ({
    key: uniqueId(check?.key || check?.label, checkKeys, 'check'),
    label: text(check?.label, 80),
    hint: text(check?.hint, 200),
    requiredToApprove: Boolean(check?.requiredToApprove),
  }))
  const stateIds = new Set(SYSTEM_FINAL_IDS)
  const rawStates = (Array.isArray(input?.states) ? input.states : []).slice(0, MAX_STATES)
  // Ids first, so actions can point at states listed after them.
  const ids = rawStates.map((state) => (SYSTEM_FINAL_IDS.includes(state?.id) ? state.id : uniqueId(state?.id || state?.label, stateIds, 'state')))
  const states = rawStates.map((state, index) => {
    const id = ids[index]
    const system = SYSTEM_FINAL_IDS.includes(id)
    const type = system ? 'final' : STATE_TYPES[state?.type] && state.type !== 'final' ? state.type : 'work'
    const actionIds = new Set()
    const products = (Array.isArray(state?.products) ? state.products : []).filter((product) => PRODUCTS.includes(product))
    return {
      id,
      label: text(state?.label, 60),
      ...(state?.stageLabel ? { stageLabel: text(state.stageLabel, 60) } : {}),
      description: text(state?.description, 300),
      type,
      roles: [...new Set((Array.isArray(state?.roles) ? state.roles : []).filter((role) => typeof role === 'string' && /^[a-z0-9_]{1,40}$/.test(role)))],
      products: products.length === PRODUCTS.length ? [] : [...new Set(products)],
      requiredChecks: [...new Set((Array.isArray(state?.requiredChecks) ? state.requiredChecks : []).filter((key) => checkKeys.has(key)))],
      askApplicant: Boolean(state?.askApplicant),
      handToLms: Boolean(state?.handToLms),
      trackProgress: Boolean(state?.trackProgress),
      ...(state?.disabled && !system ? { disabled: true } : {}),
      ...(type === 'offer' ? { offer: { onAccept: text(state?.offer?.onAccept, 60) } } : {}),
      // Left out when the editor sent none, so an offer state keeps sending the offer documents.
      ...(type !== 'final' && Array.isArray(state?.documents)
        ? {
            documents: state.documents
              .slice(0, MAX_DOCUMENTS)
              .filter((entry) => typeof entry?.kind === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(entry.kind))
              .map((entry) => ({ kind: entry.kind, required: Boolean(entry.required) })),
          }
        : {}),
      actions:
        type === 'final'
          ? []
          : (Array.isArray(state?.actions) ? state.actions : []).slice(0, MAX_ACTIONS).map((action) => ({
              id: uniqueId(action?.id || action?.label, actionIds, 'action'),
              label: text(action?.label, 60),
              kind: ACTION_KINDS[action?.kind] ? action.kind : 'move',
              to: text(action?.to, 60),
              ...(PERMISSIONS.includes(action?.permission) ? { permission: action.permission } : {}),
              options: {
                ...(action?.options?.claim ? { claim: true } : {}),
                ...(action?.options?.requireNote ? { requireNote: true } : {}),
                ...(action?.options?.fourEyes ? { fourEyes: true } : {}),
                ...(action?.options?.singleStep ? { singleStep: true } : {}),
                checks: [...new Set((Array.isArray(action?.options?.checks) ? action.options.checks : []).filter((key) => checkKeys.has(key)))],
              },
            })),
    }
  })
  return { start: text(input?.start, 60), checklist, states }
}

// With their permissions: a role named on a state must hold what its actions need.
const workspaceRoles = async () => (await listRoles()).map(({ key, label, permissions }) => ({ key, label, permissions }))

// Every document kind, retired ones too, so a state still sending one is told why it can't.
const documentKinds = async () => (await listDocumentKinds({ includeRetired: true })).map(({ key, label, requiresSignature, retired }) => ({ key, label, requiresSignature, retired }))

const validate = async (definition) => validateWorkflow(definition, { roles: await workspaceRoles(), documentKinds: await documentKinds() })

const describeVersion = (flow) => ({ version: flow.version, legacy: flow.legacy, definition: flow.definition, publishedAt: flow.publishedAt })

/** The editor's view: the published workflow, the draft (if any), and the version history. */
const getEditor = async (req) => {
  await requireUser(req, { permission: 'settings.manage' })
  const [published, draft, history] = await Promise.all([getPublishedWorkflow(), getDraftWorkflow(), listWorkflowHistory()])
  return {
    published: describeVersion(published),
    draft: draft ? { definition: draft.definition, note: draft.note, updatedAt: draft.updatedAt } : null,
    history,
    documentKinds: await documentKinds(),
  }
}

const saveDraft = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const definition = sanitizeWorkflow(req.body?.definition)
  const draft = await saveDraftWorkflow(definition, text(req.body?.note, 300) || null, actor)
  await recordAudit({ req, actor, action: 'workflow.draft_saved', entityType: 'workflow', entityId: null, detail: { states: definition.states.length } })
  return { draft: { definition: draft.definition, note: draft.note, updatedAt: draft.updatedAt }, validation: await validate(definition) }
}

const discardDraft = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  await discardDraftWorkflow()
  await recordAudit({ req, actor, action: 'workflow.draft_discarded', entityType: 'workflow', entityId: null })
  return { ok: true }
}

/** Publishes the draft for new applications, if it passes every check. */
const publish = async (req, res) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const draft = await getDraftWorkflow()
  if (!draft) fail(400, 'Save a draft before publishing.', 'no_draft')
  const validation = await validate(draft.definition)
  if (validation.errors.length) {
    res.status(400).json({ code: 'invalid_workflow', message: `Fix these first: ${validation.errors.map((error) => error.message).join(' ')}`, errors: validation.errors })
    return undefined
  }
  const published = await publishDraftWorkflow(actor, text(req.body?.note, 300) || null)
  await recordAudit({ req, actor, action: 'workflow.published', entityType: 'workflow', entityId: null, detail: { version: published.version } })
  return { published: describeVersion(published) }
}

/**
 * Moves open cases on older versions onto the published one, where the state they are in
 * still exists there (by id) and is on. The others stay where they are, to finish on their version.
 */
const moveCases = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const current = await getPublishedWorkflow()
  const db = await getDb()
  const open = await db
    .select({ id: applications.id, state: applications.state, status: applications.status, workflowVersion: applications.workflowVersion, version: applications.version })
    .from(applications)
    .where(and(notInArray(applications.state, SYSTEM_FINAL_IDS), ne(applications.workflowVersion, current.version)))
  let moved = 0
  for (const row of open) {
    const target = stateById(current.definition, row.state)
    if (!target || target.type === 'final' || target.disabled) continue
    const status = row.status === 'info_requested' && target.askApplicant ? 'info_requested' : current.analysis.categories[target.id]
    const [updated] = await db
      .update(applications)
      .set({ workflowVersion: current.version, status, ...(status !== 'info_requested' ? { infoRequest: null } : {}), version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, row.id), eq(applications.version, row.version)))
      .returning({ id: applications.id })
    if (updated) moved += 1
  }
  await recordAudit({ req, actor, action: 'workflow.cases_moved', entityType: 'workflow', entityId: null, detail: { version: current.version, moved, kept: open.length - moved } })
  return { moved, kept: open.length - moved }
}

export const workflowConfigRoutes = [
  ['GET', '/workflow', workflowForStaff],
  ['GET', '/admin/workflow', getEditor],
  ['PUT', '/admin/workflow/draft', saveDraft],
  ['DELETE', '/admin/workflow/draft', discardDraft],
  ['POST', '/admin/workflow/publish', publish],
  ['POST', '/admin/workflow/move-cases', moveCases],
]
