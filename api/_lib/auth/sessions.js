import { eq, lt, or } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { parseCookies, clientIp } from '../http.js'
import { newToken, hashToken } from './tokens.js'
import { isStaffRole } from '../../../src/config/roles.js'

const { sessions, users } = schema

export const SESSION_COOKIE = 'los_session'

// Staff handle applicants' personal data all day, so an unattended browser signs out
// after a few idle hours and no session outlives a working day.
const LIMITS = {
  staff: { idleMs: 4 * 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
  customer: { idleMs: 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
}
const limitsFor = (role) => (isStaffRole(role) ? LIMITS.staff : LIMITS.customer)

// last_seen_at is refreshed at most this often, so reads do not each cost a write.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

const isSecureContext = () => Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'

const serializeCookie = (value, maxAgeSeconds) =>
  [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    isSecureContext() ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ')

/** Fields safe to send to the browser. */
export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  phone: user.phone,
  role: user.role,
  status: user.status,
  managerId: user.managerId,
  referralCode: user.referralCode,
  isDemo: user.isDemo,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  notificationPrefs: user.notificationPrefs || {},
  twoFactorEnabled: Boolean(user.totpEnabledAt),
})

export const createSession = async (req, res, user) => {
  const db = await getDb()
  const token = newToken()
  const { absoluteMs } = limitsFor(user.role)
  await db.insert(sessions).values({
    id: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + absoluteMs),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  })
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
  res.setHeader('Set-Cookie', serializeCookie(token, Math.floor(absoluteMs / 1000)))
}

/** The signed-in user for this request, or null. Expired and idle sessions are removed as they are found. */
export const getSessionUser = async (req) => {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token) return null

  const db = await getDb()
  const id = hashToken(token)
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1)
  if (!row) return null

  const now = Date.now()
  const { idleMs } = limitsFor(row.user.role)
  const expired = row.session.expiresAt.getTime() <= now || row.session.lastSeenAt.getTime() + idleMs <= now
  if (expired || row.user.status !== 'active') {
    await db.delete(sessions).where(eq(sessions.id, id))
    return null
  }

  if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, id))
  }
  return row.user
}

export const destroySession = async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (token) {
    const db = await getDb()
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)))
  }
  res.setHeader('Set-Cookie', serializeCookie('', 0))
}

/** Signs a user out everywhere — on disable, role change or password change. */
export const destroyUserSessions = async (userId) => {
  const db = await getDb()
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Housekeeping for the daily cron: expired rows are otherwise only removed when presented. */
export const purgeExpiredSessions = async () => {
  const db = await getDb()
  // Staff have the longest idle window, so anything idle past it is dead for every role.
  const idleCutoff = new Date(Date.now() - LIMITS.staff.idleMs)
  await db.delete(sessions).where(or(lt(sessions.expiresAt, new Date()), lt(sessions.lastSeenAt, idleCutoff)))
}
