import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { worksOnStage } from './workflow.js'
import { getPublishedWorkflow, getWorkflowVersion } from './workflowVersions.js'

const { applications, applicationEvents, users } = schema

/*
 * Which cases staff see by stage, on top of their role's scope (applications.js): a case
 * whose current stage is one their role works on in that case's own workflow version
 * (worksOnStage), plus any case they have worked on — brought in, assigned to them (as
 * officer, RM or at a stage), or on its timeline — which they may read but not change.
 * Administrators see everything; customers and partner staff keep their own rules.
 *
 * Worked out on every request from the role's live permissions, so a change in
 * Team → Roles applies to the next one.
 */

/** Roles the stage rule leaves alone. */
const unrestricted = (viewer) => viewer.role === 'admin' || viewer.role === 'customer' || viewer.scope === 'partner'

/**
 * Every (workflow version, state id) pair `viewer` works on, over the versions cases are
 * on plus the published one (`published`, fetched once by the caller if given).
 * Returns [[version, stateId], ...].
 */
export const visibleStagePairs = async (viewer, published = null) => {
  const db = await getDb()
  const current = published || (await getPublishedWorkflow())
  const versions = (await db.selectDistinct({ version: applications.workflowVersion }).from(applications)).map((row) => row.version).filter(Boolean)
  const flows = await Promise.all([...new Set([current.version, ...versions])].map((version) => (version === current.version ? current : getWorkflowVersion(version))))
  const pairs = []
  // An unknown version falls back to the published one: count each flow once.
  const seen = new Set()
  for (const flow of flows) {
    if (seen.has(flow.version)) continue
    seen.add(flow.version)
    for (const state of flow.definition.states || []) if (worksOnStage(viewer, state, flow.definition)) pairs.push([flow.version, state.id])
  }
  return pairs
}

/**
 * The cases `viewer` has worked on, as a query condition. For a team lead (the `team.lead`
 * permission, or scope "team") that includes their team's cases, as scopeApplications reads
 * the team: brought in by one of their agents — whatever the lead's own scope, so a sales
 * manager keeps their agents' past cases too.
 */
const workedOn = (viewer) =>
  or(
    eq(applications.sourcedBy, viewer.id),
    eq(applications.assignedOfficer, viewer.id),
    eq(applications.assignedRm, viewer.id),
    eq(applications.stateAssignee, viewer.id),
    sql`exists (select 1 from ${applicationEvents} where ${applicationEvents.applicationId} = ${applications.id} and ${applicationEvents.actorId} = ${viewer.id})`,
    ...(leadsTeam(viewer) ? [sql`${applications.sourcedBy} in (select ${users.id} from ${users} where ${users.managerId} = ${viewer.id})`] : [])
  )

const leadsTeam = (viewer) => viewer.scope === 'team' || Boolean(viewer.permissions?.includes('team.lead'))

/**
 * The stage rule as a query condition: a case at a stage `viewer` works on, or one they
 * have worked on. Undefined (no restriction) for administrators, customers and partner staff.
 */
export const stageCondition = async (viewer) => {
  if (unrestricted(viewer)) return undefined
  const published = await getPublishedWorkflow()
  const pairs = await visibleStagePairs(viewer, published)
  const byVersion = new Map()
  for (const [version, stateId] of pairs) byVersion.set(version, [...(byVersion.get(version) || []), stateId])
  // A case on no version yet follows the published one (getWorkflowVersion).
  const atMyStages = [...byVersion].map(([version, stateIds]) =>
    and(version === published.version ? or(eq(applications.workflowVersion, version), isNull(applications.workflowVersion)) : eq(applications.workflowVersion, version), inArray(applications.state, stateIds))
  )
  return or(...atMyStages, workedOn(viewer))
}
