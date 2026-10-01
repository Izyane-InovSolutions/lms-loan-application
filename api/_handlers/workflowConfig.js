import { notInArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { requireUser } from '../_lib/rbac.js'
import { getPublishedWorkflow, getWorkflowVersion } from '../_lib/workflowVersions.js'
import { SYSTEM_FINAL_IDS } from '../../src/config/workflow.js'

const { applications } = schema

/*
 * The workflow as the workspace reads it (the pipeline, queues, the case page's labels).
 * The editor's own endpoints — draft, validate, publish, history — are added in the
 * Workflow editor's phase.
 */

/** What the workspace needs of one version: its states in order and their categories. */
const summarize = (flow) => ({
  version: flow.version,
  legacy: flow.legacy,
  start: flow.definition.start,
  states: flow.definition.states.map(({ id, label, type, roles = [], products = [], askApplicant = false, trackProgress = false }) => ({ id, label, type, roles, products, askApplicant, trackProgress })),
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

export const workflowConfigRoutes = [['GET', '/workflow', workflowForStaff]]
