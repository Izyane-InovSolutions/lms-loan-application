import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb, schema } from '../_lib/db/client.js'
import { fail } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { listRoles } from '../_lib/roles.js'
import { OPEN_STATUSES } from '../../src/config/applications.js'
import { COMPARED_PERIODS, DEFAULT_PERIOD, isPeriod, periodDates, periodLabel, periodRange } from '../../src/config/reportPeriods.js'

const { applications, applicationDrafts, applicationEvents, users } = schema
const manager = alias(users, 'manager')

const int = (value) => Number(value) || 0
const money = (value) => Number(value) || 0

/*
 * Agent performance (Agents page). An agent is someone whose role brings business in
 * (applications.assist) without leading a team (team.lead): a direct sales agent by
 * default. Who is listed follows the viewer's scope: everyone for "all" (sales managers,
 * administrators), the agents who report to them for "team" (relationship managers).
 *
 * Periods are on the Lusaka calendar (src/config/reportPeriods.js), and each figure is
 * counted when its own event happened, so a month's figures can be paid on: brought in by
 * the day it was submitted, approved or declined by the day it was decided, paid out by
 * the day it was paid out (its status change on the case timeline), withdrawn or lapsed by
 * the day that happened. Open applications, drafts and last activity are as of now.
 */

/** The agent roles, by key, with their labels. */
const agentRoles = async () =>
  Object.fromEntries(
    (await listRoles()).filter((role) => role.permissions.includes('applications.assist') && !role.permissions.includes('team.lead')).map((role) => [role.key, role.label])
  )

/** The agents `viewer` may see, optionally just one. */
const agentsVisibleTo = async (db, viewer, roleLabels, onlyId = null) => {
  if (!Object.keys(roleLabels).length) return []
  const reach = viewer.scope === 'all' ? null : viewer.scope === 'team' ? eq(users.managerId, viewer.id) : eq(users.id, viewer.id)
  return db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, status: users.status, createdAt: users.createdAt, managerId: users.managerId, managerName: manager.name })
    .from(users)
    .leftJoin(manager, eq(manager.id, users.managerId))
    .where(and(inArray(users.role, Object.keys(roleLabels)), ...(reach ? [reach] : []), ...(onlyId ? [eq(users.id, onlyId)] : [])))
}

/** `column` within a period's range; nothing for all time. */
const within = (column, { from, to }) => (from ? and(gte(column, from), lt(column, to)) : undefined)
const sqlWithin = (expression, { from, to }) => (from ? sql`${expression} >= ${from} and ${expression} < ${to}` : sql`true`)

/**
 * When each application first reached a status, from the case timeline: payouts, and
 * withdrawals or lapses. An application without that entry (from before the timeline
 * recorded it) falls back to the date given, so it is still counted somewhere.
 */
const firstReached = (db, statuses, name) =>
  db
    .select({ applicationId: applicationEvents.applicationId, at: sql`min(${applicationEvents.at})`.as(`${name}_at`) })
    .from(applicationEvents)
    .where(inArray(applicationEvents.toStatus, statuses))
    .groupBy(applicationEvents.applicationId)
    .as(name)

/** Each agent's figures for a period ({ from, to }), each counted by its own date, by agent id. */
const figuresIn = async (db, ids, range) => {
  const payouts = firstReached(db, ['disbursed'], 'payouts')
  const closings = firstReached(db, ['withdrawn', 'expired'], 'closings')
  const paidOn = sql`coalesce(${payouts.at}, ${applications.updatedAt})`
  const closedOn = sql`coalesce(${closings.at}, ${applications.withdrawnAt}, ${applications.updatedAt})`
  const mine = inArray(applications.sourcedBy, ids)
  const [brought, decided, paid, closed] = await Promise.all([
    db
      .select({
        agentId: applications.sourcedBy,
        submitted: sql`count(*)`,
        requested: sql`coalesce(sum(${applications.amount}), 0)`,
        personal: sql`count(*) filter (where ${applications.loanType} = 'personal')`,
        business: sql`count(*) filter (where ${applications.loanType} = 'business')`,
      })
      .from(applications)
      .where(and(mine, within(applications.submittedAt, range)))
      .groupBy(applications.sourcedBy),
    db
      .select({
        agentId: applications.sourcedBy,
        // A decision stands even if the customer later withdraws or lets the offer lapse.
        approved: sql`count(*) filter (where ${applications.status} <> 'declined')`,
        declined: sql`count(*) filter (where ${applications.status} = 'declined')`,
        decisionDays: sql`avg(extract(epoch from (${applications.decidedAt} - ${applications.submittedAt})) / 86400)`,
      })
      .from(applications)
      .where(and(mine, isNotNull(applications.decidedAt), within(applications.decidedAt, range)))
      .groupBy(applications.sourcedBy),
    db
      .select({
        agentId: applications.sourcedBy,
        disbursed: sql`count(*)`,
        disbursedValue: sql`coalesce(sum(coalesce(${applications.approvedAmount}, ${applications.amount})), 0)`,
      })
      .from(applications)
      .leftJoin(payouts, eq(payouts.applicationId, applications.id))
      .where(and(mine, eq(applications.status, 'disbursed'), sqlWithin(paidOn, range)))
      .groupBy(applications.sourcedBy),
    db
      .select({ agentId: applications.sourcedBy, closed: sql`count(*)` })
      .from(applications)
      .leftJoin(closings, eq(closings.applicationId, applications.id))
      .where(and(mine, inArray(applications.status, ['withdrawn', 'expired']), sqlWithin(closedOn, range)))
      .groupBy(applications.sourcedBy),
  ])
  const merged = {}
  for (const rows of [brought, decided, paid, closed]) for (const row of rows) merged[row.agentId] = { ...merged[row.agentId], ...row }
  return Object.fromEntries(Object.entries(merged).map(([id, row]) => [id, figuresOf(row)]))
}

/** One agent's (or a team's) figures from query rows, with the approval rate worked out. */
const figuresOf = (row = {}) => {
  const approved = int(row.approved)
  const declined = int(row.declined)
  return {
    submitted: int(row.submitted),
    requested: money(row.requested),
    approved,
    declined,
    disbursed: int(row.disbursed),
    disbursedValue: money(row.disbursedValue),
    closed: int(row.closed),
    personal: int(row.personal),
    business: int(row.business),
    approvalRate: approved + declined ? approved / (approved + declined) : null,
    decisionDays: row.decisionDays === null || row.decisionDays === undefined ? null : Number(row.decisionDays),
  }
}

/** What each agent has on now: open applications, drafts in progress, and last activity (a submission or a draft save), by agent id. */
const activityOf = async (db, ids) => {
  const [latest, drafts] = await Promise.all([
    db
      .select({
        agentId: applications.sourcedBy,
        at: sql`max(${applications.submittedAt})`,
        open: sql`count(*) filter (where ${inArray(applications.status, OPEN_STATUSES)})`,
        openValue: sql`coalesce(sum(${applications.amount}) filter (where ${inArray(applications.status, OPEN_STATUSES)}), 0)`,
      })
      .from(applications)
      .where(inArray(applications.sourcedBy, ids))
      .groupBy(applications.sourcedBy),
    db
      .select({ agentId: applicationDrafts.sourcedBy, count: sql`count(*)`, value: sql`coalesce(sum(${applicationDrafts.amount}), 0)`, lastSaved: sql`max(${applicationDrafts.updatedAt})` })
      .from(applicationDrafts)
      .where(and(inArray(applicationDrafts.sourcedBy, ids), gte(applicationDrafts.expiresAt, new Date())))
      .groupBy(applicationDrafts.sourcedBy),
  ])
  const latestOf = Object.fromEntries(latest.map((row) => [row.agentId, row.at]))
  const openOf = Object.fromEntries(latest.map((row) => [row.agentId, row]))
  const draftsOf = Object.fromEntries(drafts.map((row) => [row.agentId, row]))
  return Object.fromEntries(
    ids.map((id) => {
      const last = [latestOf[id], draftsOf[id]?.lastSaved].filter(Boolean).map((value) => new Date(value)).sort((a, b) => b - a)[0] || null
      return [id, { open: int(openOf[id]?.open), openValue: money(openOf[id]?.openValue), drafts: int(draftsOf[id]?.count), draftsValue: money(draftsOf[id]?.value), lastActive: last ? last.toISOString() : null }]
    })
  )
}

const personOf = (person, roleLabels) => ({
  id: person.id,
  name: person.name,
  email: person.email,
  role: person.role,
  roleLabel: roleLabels[person.role],
  status: person.status,
  managerId: person.managerId,
  managerName: person.managerName,
})

/** Every agent the viewer may see, with their figures for one period. */
const agentReport = async (req, res, { query }) => {
  const viewer = await requireUser(req, { permission: 'reports.team' })
  const period = query.get('period') || DEFAULT_PERIOD
  if (!isPeriod(period)) fail(400, 'Choose this month, last month, a past month, 30, 60 or 90 days, or all time.', 'invalid_period')
  const db = await getDb()
  const roleLabels = await agentRoles()
  const people = await agentsVisibleTo(db, viewer, roleLabels)
  const about = { period, label: periodLabel(period), dates: periodDates(period) }
  if (!people.length) return { ...about, scope: viewer.scope, agents: [], totals: totalsOf([]) }

  const ids = people.map((person) => person.id)
  const [figures, activity] = await Promise.all([figuresIn(db, ids, periodRange(period)), activityOf(db, ids)])
  const agents = people
    .map((person) => ({ ...personOf(person, roleLabels), ...(figures[person.id] || figuresOf()), ...activity[person.id] }))
    // Switched-off agents only while they have figures to show.
    .filter((agent) => agent.status !== 'disabled' || agent.submitted || agent.drafts)
    .sort((a, b) => b.submitted - a.submitted || b.disbursedValue - a.disbursedValue || a.name.localeCompare(b.name))

  return { ...about, scope: viewer.scope, agents, totals: totalsOf(agents) }
}

/**
 * One agent, for their page in Agents: every figure for each period side by side (this
 * month, last month, 30, 60 and 90 days, all time, and a past month chosen on the list),
 * what they have on now, and their latest applications. A 404,
 * not a 403, for an agent outside the viewer's reach, so it doesn't confirm they exist.
 */
const agentDetail = async (req, res, { params, query }) => {
  const viewer = await requireUser(req, { permission: 'reports.team' })
  // The usual periods, plus a past month chosen on the list.
  const chosen = query.get('period')
  const sameAs = (a, b) => periodRange(a).from?.getTime() === periodRange(b).from?.getTime() && periodRange(a).to?.getTime() === periodRange(b).to?.getTime()
  const extra = chosen && isPeriod(chosen) && !COMPARED_PERIODS.some((period) => period === chosen || sameAs(period, chosen))
  const columns = extra ? [chosen, ...COMPARED_PERIODS] : COMPARED_PERIODS
  if (!/^[0-9a-f-]{36}$/i.test(String(params.id))) fail(404, 'Agent not found.', 'not_found')
  const db = await getDb()
  const roleLabels = await agentRoles()
  const [person] = await agentsVisibleTo(db, viewer, roleLabels, params.id)
  if (!person) fail(404, 'Agent not found.', 'not_found')

  const [byPeriod, activity, recent] = await Promise.all([
    Promise.all(columns.map(async (period) => [period, (await figuresIn(db, [person.id], periodRange(period)))[person.id] || figuresOf()])),
    activityOf(db, [person.id]),
    db
      .select({ id: applications.id, reference: applications.reference, applicantName: applications.applicantName, companyName: applications.companyName, loanType: applications.loanType, amount: applications.amount, status: applications.status, submittedAt: applications.submittedAt })
      .from(applications)
      .where(eq(applications.sourcedBy, person.id))
      .orderBy(desc(applications.submittedAt))
      .limit(8),
  ])

  return {
    scope: viewer.scope,
    agent: { ...personOf(person, roleLabels), phone: person.phone, joinedAt: person.createdAt, ...activity[person.id] },
    periods: byPeriod.map(([period, figures]) => ({ period, label: periodLabel(period), dates: periodDates(period), ...figures })),
    recent,
  }
}

/** The whole team's figures: sums, with the rates worked out again from them. */
const totalsOf = (agents) => {
  const sum = (key) => agents.reduce((total, agent) => total + agent[key], 0)
  const approved = sum('approved')
  const declined = sum('declined')
  return {
    agents: agents.length,
    active: agents.filter((agent) => agent.submitted || agent.drafts).length,
    submitted: sum('submitted'),
    requested: sum('requested'),
    open: sum('open'),
    openValue: sum('openValue'),
    approved,
    declined,
    disbursed: sum('disbursed'),
    disbursedValue: sum('disbursedValue'),
    closed: sum('closed'),
    drafts: sum('drafts'),
    approvalRate: approved + declined ? approved / (approved + declined) : null,
  }
}

export const reportRoutes = [
  ['GET', '/reports/agents', agentReport],
  ['GET', '/reports/agents/:id', agentDetail],
]
