import { and, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { getSetting } from './settings.js'
import { sendStaffNotificationEmail } from './email.js'
import { OPEN_STATUSES } from '../../src/config/applications.js'
import { rolesWith } from './roles.js'

const { notifications, users, applications } = schema

/**
 * Notifies staff: a row for each person's bell, and an email unless staff emails are
 * off in Settings or the person switched them off. `origin` builds the link in emails.
 * Never throws — a notification must not fail the action that caused it.
 */
export const notifyUsers = async (userIds, { type, title, body = null, applicationId = null }, { origin } = {}) => {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return
  try {
    const db = await getDb()
    const people = await db.select().from(users).where(and(inArray(users.id, ids), eq(users.status, 'active')))
    if (!people.length) return
    const rows = await db
      .insert(notifications)
      .values(people.map((person) => ({ userId: person.id, type, title, body, applicationId })))
      .returning()
    const { staffEmail } = await getSetting('notifications')
    if (!staffEmail || !origin) return
    const link = applicationId ? `${origin}/admin/applications/${applicationId}` : `${origin}/admin`
    for (const person of people) {
      if (person.isDemo || person.notificationPrefs?.email === false) continue
      try {
        await sendStaffNotificationEmail(person.email, { name: person.name, title, body, url: link })
        const row = rows.find((entry) => entry.userId === person.id)
        await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, row.id))
      } catch (error) {
        console.warn(`[notify] email to staff failed: ${error?.message}`)
      }
    }
  } catch (error) {
    console.warn(`[notify] ${type} not recorded: ${error?.message}`)
  }
}

/**
 * Active staff whose role holds `permission` — by default everyone who reviews cases —
 * optionally leaving someone out (e.g. who made the recommendation).
 */
export const creditStaffIds = async ({ except, permission = 'cases.work' } = {}) => {
  const roleKeys = await rolesWith(permission)
  if (!roleKeys.length) return []
  const db = await getDb()
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roleKeys), eq(users.status, 'active'), except ? ne(users.id, except) : undefined))
  return rows.map((row) => row.id)
}

/** Who follows a case besides credit staff: the person who brought it in, and their RM. */
export const followerIds = (application) => [application.sourcedBy, application.assignedRm, application.assignedOfficer].filter(Boolean)

/**
 * Cron: a daily nudge about cases open longer than the target (Settings → Workflow).
 * The assigned officer hears about theirs; unassigned ones go to all credit staff.
 */
export const sendOverdueDigest = async ({ origin } = {}) => {
  const db = await getDb()
  const { slaDays } = await getSetting('workflow')
  const cutoff = new Date(Date.now() - slaDays * 86400000)
  const overdue = await db
    .select({ officer: applications.assignedOfficer, count: sql`count(*)::int` })
    .from(applications)
    .where(and(inArray(applications.status, OPEN_STATUSES), lt(applications.submittedAt, cutoff)))
    .groupBy(applications.assignedOfficer)
  for (const row of overdue) {
    const title = `${row.count} ${row.count === 1 ? 'case has' : 'cases have'} been open more than ${slaDays} days`
    const recipients = row.officer ? [row.officer] : await creditStaffIds()
    await notifyUsers(recipients, { type: 'overdue', title, body: row.officer ? 'Assigned to you.' : 'Nobody has taken them yet.' }, { origin })
  }
  return overdue.reduce((sum, row) => sum + row.count, 0)
}

export const unreadCount = async (userId) => {
  const db = await getDb()
  const [row] = await db.select({ count: sql`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return row.count
}
