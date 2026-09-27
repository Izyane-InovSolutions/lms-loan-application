import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { requireUser } from '../_lib/rbac.js'
import { scopeApplications } from '../_lib/applications.js'
import { getSetting } from '../_lib/settings.js'
import { APPROVED_STATUSES, OPEN_STATUSES } from '../../src/config/applications.js'

const { applications, prescreens, users, appraisals } = schema

const DAY_MS = 24 * 60 * 60 * 1000
const APPROVED = APPROVED_STATUSES

const where = (...clauses) => {
  const kept = clauses.filter(Boolean)
  return kept.length ? and(...kept) : undefined
}

const int = (value) => Number(value) || 0

/**
 * The home dashboard for the signed-in role. Every figure is limited to the applications
 * that role may see (scopeApplications), so an agent's "approval rate" is theirs alone.
 *
 * `days` (7–365, default 30) sets the period; KPIs compare it with the period before.
 */
const dashboard = async (req, res, { query }) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const scope = scopeApplications(viewer)
  const days = Math.min(365, Math.max(7, Number(query.get('days')) || 30))
  const now = new Date()
  const start = new Date(now.getTime() - days * DAY_MS)
  const previousStart = new Date(start.getTime() - days * DAY_MS)

  const periodStats = async (from, to) => {
    const [row] = await db
      .select({
        submitted: sql`count(*) filter (where ${applications.submittedAt} >= ${from} and ${applications.submittedAt} < ${to})`,
        approved: sql`count(*) filter (where ${applications.decidedAt} >= ${from} and ${applications.decidedAt} < ${to} and ${inArray(applications.status, APPROVED)})`,
        declined: sql`count(*) filter (where ${applications.decidedAt} >= ${from} and ${applications.decidedAt} < ${to} and ${applications.status} = 'declined')`,
        approvedValue: sql`coalesce(sum(coalesce(${applications.approvedAmount}, ${applications.amount})) filter (where ${applications.decidedAt} >= ${from} and ${applications.decidedAt} < ${to} and ${inArray(applications.status, APPROVED)}), 0)`,
        decisionHours: sql`avg(extract(epoch from (${applications.decidedAt} - ${applications.submittedAt})) / 3600) filter (where ${applications.decidedAt} >= ${from} and ${applications.decidedAt} < ${to})`,
      })
      .from(applications)
      .where(scope)
    const approved = int(row.approved)
    const declined = int(row.declined)
    return {
      submitted: int(row.submitted),
      approved,
      declined,
      approvalRate: approved + declined ? approved / (approved + declined) : null,
      approvedValue: Number(row.approvedValue) || 0,
      decisionHours: row.decisionHours === null ? null : Number(row.decisionHours),
    }
  }

  const [current, previous, [pipeline], funnel, trend, mix, outcomes] = await Promise.all([
    periodStats(start, now),
    periodStats(previousStart, start),
    db
      .select({ count: sql`count(*)`, value: sql`coalesce(sum(${applications.amount}), 0)` })
      .from(applications)
      .where(where(scope, inArray(applications.status, OPEN_STATUSES))),
    db
      .select({ status: applications.status, count: sql`count(*)`, value: sql`coalesce(sum(${applications.amount}), 0)` })
      .from(applications)
      .where(where(scope, gte(applications.submittedAt, start)))
      .groupBy(applications.status),
    db
      .select({ day: sql`to_char(date_trunc('day', ${applications.submittedAt}), 'YYYY-MM-DD')`, channel: applications.channel, count: sql`count(*)` })
      .from(applications)
      .where(where(scope, gte(applications.submittedAt, start)))
      .groupBy(sql`1`, applications.channel)
      .orderBy(sql`1`),
    db
      .select({ loanType: applications.loanType, count: sql`count(*)`, value: sql`coalesce(sum(${applications.amount}), 0)` })
      .from(applications)
      .where(where(scope, gte(applications.submittedAt, start)))
      .groupBy(applications.loanType),
    db
      .select({ outcome: prescreens.outcome, count: sql`count(*)` })
      .from(prescreens)
      .innerJoin(applications, eq(applications.id, prescreens.applicationId))
      .where(where(scope, gte(applications.submittedAt, start)))
      .groupBy(prescreens.outcome),
  ])

  const result = {
    role: viewer.role,
    days,
    kpis: { current, previous, pipeline: { count: int(pipeline.count), value: Number(pipeline.value) || 0 } },
    funnel: funnel.map((row) => ({ status: row.status, count: int(row.count), value: Number(row.value) || 0 })),
    trend: trend.map((row) => ({ day: row.day, channel: row.channel, count: int(row.count) })),
    mix: mix.map((row) => ({ loanType: row.loanType, count: int(row.count), value: Number(row.value) || 0 })),
    prescreenOutcomes: Object.fromEntries(outcomes.map((row) => [row.outcome, int(row.count)])),
  }

  // Who brings business in: agents and RMs, within the viewer's scope.
  if (['admin', 'sales_manager', 'rm'].includes(viewer.role)) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        submitted: sql`count(*)`,
        approved: sql`count(*) filter (where ${inArray(applications.status, APPROVED)})`,
        decided: sql`count(*) filter (where ${isNotNull(applications.decidedAt)})`,
        approvedValue: sql`coalesce(sum(coalesce(${applications.approvedAmount}, ${applications.amount})) filter (where ${inArray(applications.status, APPROVED)}), 0)`,
      })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.sourcedBy))
      .where(where(scope, gte(applications.submittedAt, start)))
      .groupBy(users.id, users.name, users.role)
      .orderBy(desc(sql`count(*)`))
      .limit(10)
    result.leaderboard = rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      submitted: int(row.submitted),
      approved: int(row.approved),
      conversion: int(row.decided) ? int(row.approved) / int(row.decided) : null,
      approvedValue: Number(row.approvedValue) || 0,
    }))
  }

  if (viewer.role === 'admin') {
    const rows = await db
      .select({ status: applications.lmsSyncStatus, count: sql`count(*)` })
      .from(applications)
      .where(ne(applications.lmsSyncStatus, 'not_configured'))
      .groupBy(applications.lmsSyncStatus)
    result.lmsHealth = Object.fromEntries(rows.map((row) => [row.status, int(row.count)]))
  }

  if (['loan_officer', 'admin'].includes(viewer.role)) {
    const { slaDays } = await getSetting('workflow')
    const overdueBefore = new Date(now.getTime() - slaDays * DAY_MS)
    const [queue] = await db
      .select({
        unassigned: sql`count(*) filter (where ${isNull(applications.assignedOfficer)} and ${inArray(applications.status, OPEN_STATUSES)})`,
        mine: sql`count(*) filter (where ${applications.assignedOfficer} = ${viewer.id} and ${inArray(applications.status, OPEN_STATUSES)})`,
        awaitingDecision: sql`count(*) filter (where ${applications.status} = 'pending_approval')`,
        waitingOnApplicant: sql`count(*) filter (where ${applications.status} = 'info_requested')`,
        overdue: sql`count(*) filter (where ${inArray(applications.status, OPEN_STATUSES)} and ${lt(applications.submittedAt, overdueBefore)})`,
      })
      .from(applications)
    const [mine] = await db
      .select({
        judgements: sql`count(*)`,
        approvals: sql`count(*) filter (where ${appraisals.verdict} = 'approve')`,
      })
      .from(appraisals)
      .where(and(eq(appraisals.officerId, viewer.id), gte(appraisals.createdAt, start)))
    result.queue = {
      unassigned: int(queue.unassigned),
      mine: int(queue.mine),
      awaitingDecision: int(queue.awaitingDecision),
      waitingOnApplicant: int(queue.waitingOnApplicant),
      overdue: int(queue.overdue),
      slaDays,
      myJudgements: int(mine.judgements),
      myApprovals: int(mine.approvals),
    }
  }

  // Agents and RMs see their latest cases on the dashboard itself.
  if (['dsa', 'rm'].includes(viewer.role)) {
    result.recent = await db
      .select({ id: applications.id, reference: applications.reference, applicantName: applications.applicantName, loanType: applications.loanType, amount: applications.amount, status: applications.status, submittedAt: applications.submittedAt })
      .from(applications)
      .where(scope)
      .orderBy(desc(applications.submittedAt))
      .limit(8)
  }

  return result
}

/** Public: who a referral link belongs to — first name and role only — for the landing banner. */
const referral = async (req, res, { params }) => {
  const db = await getDb()
  const code = String(params.code || '').toUpperCase().slice(0, 20)
  const [person] = await db
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.referralCode, code), inArray(users.role, ['dsa', 'rm']), eq(users.status, 'active')))
    .limit(1)
  if (!person) return { referrer: null }
  return { referrer: { firstName: person.name.split(' ')[0], role: person.role, code } }
}

export const dashboardRoutes = [
  ['GET', '/dashboard', dashboard],
  ['GET', '/referrals/:code', referral],
]
