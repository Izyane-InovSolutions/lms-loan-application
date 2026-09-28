import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { requireUser } from '../_lib/rbac.js'
import { userCounts } from './users.js'
import { demoEnabled } from './auth.js'

const { auditLog, users } = schema

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What the signed-in person's home page shows. Grows each phase as applications,
 * prescreens and decisions arrive; for now it covers people and activity.
 */
const overview = async (req) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const result = { role: viewer.role }

  if (viewer.role === 'admin') {
    const since = new Date(Date.now() - 14 * DAY_MS)
    const [counts, recent, activity] = await Promise.all([
      // Where demo access is on, the sample staff count, so the walkthrough has a team.
      userCounts(db, { includeDemo: demoEnabled() }),
      db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(8),
      db
        .select({ day: sql`date_trunc('day', ${auditLog.at})`.as('day'), count: sql`count(*)::int` })
        .from(auditLog)
        .where(gte(auditLog.at, since))
        .groupBy(sql`day`)
        .orderBy(sql`day`),
    ])
    Object.assign(result, {
      userCounts: counts,
      recentActivity: recent,
      activityByDay: activity.map((row) => ({ day: new Date(row.day).toISOString().slice(0, 10), count: row.count })),
    })
  }

  if (viewer.role === 'rm') {
    const team = await db
      .select({ id: users.id, name: users.name, email: users.email, status: users.status, referralCode: users.referralCode })
      .from(users)
      .where(and(eq(users.managerId, viewer.id), eq(users.role, 'dsa')))
      .orderBy(users.name)
    result.team = team
  }

  return result
}

export const overviewRoutes = [['GET', '/overview', overview]]
