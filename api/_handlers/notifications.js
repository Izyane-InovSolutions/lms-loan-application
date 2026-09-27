import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { requireUser } from '../_lib/rbac.js'
import { unreadCount } from '../_lib/notify.js'

const { notifications, users } = schema

/** The signed-in person's latest notifications and how many are unread. */
const list = async (req) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const rows = await db.select().from(notifications).where(eq(notifications.userId, viewer.id)).orderBy(desc(notifications.createdAt)).limit(30)
  return { notifications: rows, unread: await unreadCount(viewer.id) }
}

/** Marks some ({ ids }) or all ({ all: true }) as read. */
const markRead = async (req) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : []
  const scope = req.body?.all ? undefined : inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt), scope))
  return { unread: await unreadCount(viewer.id) }
}

/** The person's own preferences: { email: boolean } for notification emails. */
const savePreferences = async (req) => {
  const viewer = await requireUser(req, { staff: true })
  const db = await getDb()
  const prefs = { ...(viewer.notificationPrefs || {}), email: req.body?.email !== false }
  await db.update(users).set({ notificationPrefs: prefs, updatedAt: new Date() }).where(eq(users.id, viewer.id))
  return { notificationPrefs: prefs }
}

export const notificationRoutes = [
  ['GET', '/notifications', list],
  ['POST', '/notifications/read', markRead],
  ['PUT', '/me/preferences', savePreferences],
]
