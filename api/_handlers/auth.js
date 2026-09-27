import crypto from 'node:crypto'
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text, email as parseEmail, appOrigin, parseCookies } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { decryptSecret, encryptSecret } from '../_lib/secrets.js'
import { newRecoveryCodes, newTotpSecret, otpauthUrl, useRecoveryCode, verifyTotp } from '../_lib/auth/totp.js'
import { needsTwoFactorSetup } from '../_lib/auth/twoFactor.js'
import { hashPassword, verifyPassword, verifyAgainstDummy, validatePassword } from '../_lib/auth/password.js'
import { newToken, hashToken } from '../_lib/auth/tokens.js'
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  destroyUserSessions,
  getSessionUser,
  publicUser,
} from '../_lib/auth/sessions.js'
import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { sendPasswordLinkEmail } from '../_lib/email.js'
import { recordAudit } from '../_lib/audit.js'
import { ROLES, STAFF_ROLES, isStaffRole, roleLabel } from '../../src/config/roles.js'

const { users, passwordTokens, sessions } = schema

const RESET_TTL_MS = 60 * 60 * 1000
const LOGIN_WINDOW_SECONDS = 15 * 60
const MAX_LOGIN_FAILURES = 10

/*
 * Demo sign-in lets anyone try each role without an account — for presenting the
 * system. On by default only in local development; a deployment must opt in.
 */
export const demoEnabled = () =>
  process.env.LOS_DEMO_ENABLED === 'true' ||
  (!process.env.VERCEL && process.env.NODE_ENV !== 'production' && process.env.LOS_DEMO_ENABLED !== 'false')

const rateKey = (scope, value) => `los:${scope}:${crypto.createHash('sha256').update(value).digest('hex')}`

/** Counts an attempt; true while under the limit. Fixed window, keyed by the email so one account cannot be brute-forced. */
const underLimit = async (key, max, windowSeconds) => {
  const count = await kv.incr(key)
  if (count === 1) await kv.expire(key, windowSeconds)
  return count <= max
}

/*
 * The first administrator. With no staff accounts yet there is nobody to send an
 * invite, so LOS_ADMIN_EMAIL / LOS_ADMIN_PASSWORD seed one on the first sign-in attempt.
 * Ignored as soon as any staff account exists, so the variables can stay set.
 */
const bootstrapAdmin = async (db) => {
  const bootstrapEmail = parseEmail(process.env.LOS_ADMIN_EMAIL)
  const password = process.env.LOS_ADMIN_PASSWORD
  if (!bootstrapEmail || !password) return
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, STAFF_ROLES), eq(users.isDemo, false)))
    .limit(1)
  if (existing) return
  let passwordHash
  try {
    passwordHash = await hashPassword(password)
  } catch (error) {
    // A misconfigured bootstrap must not break every sign-in with a password error
    // meant for someone else; say what to fix where the operator will see it.
    console.warn(`[auth] LOS_ADMIN_PASSWORD not used: ${error.message} No administrator was created.`)
    return
  }
  await db
    .insert(users)
    .values({
      email: bootstrapEmail,
      name: text(process.env.LOS_ADMIN_NAME, 100) || 'Administrator',
      role: 'admin',
      status: 'active',
      passwordHash,
    })
    .onConflictDoNothing()
}

const me = async (req) => {
  const user = await getSessionUser(req)
  return {
    user: user ? { ...publicUser(user), twoFactorSetupRequired: isStaffRole(user.role) && (await needsTwoFactorSetup(user)) } : null,
    demoEnabled: demoEnabled(),
  }
}

const TWO_FACTOR_CHALLENGE_SECONDS = 5 * 60
const challengeKey = (token) => `los:2fa-challenge:${hashToken(token)}`

const login = async (req, res) => {
  const email = parseEmail(req.body?.email)
  const password = req.body?.password
  if (!email || typeof password !== 'string' || !password) fail(400, 'Enter your email and password.', 'invalid_input')

  if (!(await underLimit(rateKey('login', email), MAX_LOGIN_FAILURES, LOGIN_WINDOW_SECONDS))) {
    fail(429, 'Too many sign-in attempts. Try again in 15 minutes.', 'rate_limited')
  }

  const db = await getDb()
  await bootstrapAdmin(db)
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  // One message for every failure, so the form cannot be used to discover which emails
  // have accounts. The dummy check keeps the timing the same too.
  const invalid = () => fail(401, 'That email and password don’t match an active staff account.', 'invalid_credentials')
  if (!user || !isStaffRole(user.role) || !user.passwordHash) {
    await verifyAgainstDummy(password)
    invalid()
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordAudit({ req, actor: user, action: 'auth.login_failed', entityType: 'user', entityId: user.id })
    invalid()
  }
  if (user.status !== 'active') invalid()

  await kv.del(rateKey('login', email))

  // Two-step sign-in: the password is right, but the session waits for the code.
  if (user.totpEnabledAt) {
    const challenge = newToken()
    await kv.set(challengeKey(challenge), { userId: user.id, attempts: 0 }, { ex: TWO_FACTOR_CHALLENGE_SECONDS })
    return { twoFactorRequired: true, challenge }
  }

  await createSession(req, res, user)
  await recordAudit({ req, actor: user, action: 'auth.login', entityType: 'user', entityId: user.id })
  return { user: publicUser(user) }
}

/** Second step: the authenticator code, or one of the recovery codes. */
const verifyLogin = async (req, res) => {
  const challenge = text(req.body?.challenge, 100)
  const code = text(req.body?.code, 20)
  const stored = challenge ? await kv.get(challengeKey(challenge)) : null
  if (!stored) fail(401, 'That sign-in has expired. Enter your password again.', 'challenge_expired')
  if (stored.attempts >= 5) {
    await kv.del(challengeKey(challenge))
    fail(429, 'Too many wrong codes. Enter your password again.', 'rate_limited')
  }

  const db = await getDb()
  const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1)
  if (!user || user.status !== 'active' || !user.totpEnabledAt) fail(401, 'That sign-in has expired. Enter your password again.', 'challenge_expired')

  const secret = decryptSecret(user.totpSecret)
  let usedRecovery = false
  if (!secret || !verifyTotp(secret, code)) {
    const remaining = useRecoveryCode(user.recoveryCodes, code)
    if (!remaining) {
      await kv.set(challengeKey(challenge), { ...stored, attempts: stored.attempts + 1 }, { keepTtl: true })
      fail(400, 'That code isn’t right. Check your authenticator app and try again.', 'invalid_code')
    }
    await db.update(users).set({ recoveryCodes: remaining }).where(eq(users.id, user.id))
    usedRecovery = true
  }
  await kv.del(challengeKey(challenge))
  await createSession(req, res, user)
  await recordAudit({ req, actor: user, action: usedRecovery ? 'auth.login_recovery_code' : 'auth.login', entityType: 'user', entityId: user.id })
  return { user: publicUser(user), usedRecoveryCode: usedRecovery }
}

/** Starts setup: a new secret (stored encrypted, not yet active) and the QR link for it. */
const setupTwoFactor = async (req) => {
  const user = await requireUser(req, { staff: true, allowTwoFactorSetup: true })
  if (user.totpEnabledAt) fail(409, 'Two-step sign-in is already on. Turn it off first to set up a new phone.', 'already_enabled')
  const secret = newTotpSecret()
  const db = await getDb()
  await db.update(users).set({ totpSecret: encryptSecret(secret), updatedAt: new Date() }).where(eq(users.id, user.id))
  return { secret, otpauthUrl: otpauthUrl({ secret, email: user.email }) }
}

/** Confirms setup with a first code; returns recovery codes, shown this once. */
const enableTwoFactor = async (req) => {
  const user = await requireUser(req, { staff: true, allowTwoFactorSetup: true })
  const secret = decryptSecret(user.totpSecret)
  if (!secret) fail(400, 'Start the setup again.', 'no_setup')
  if (!verifyTotp(secret, req.body?.code)) fail(400, 'That code isn’t right. Enter the six digits your app shows now.', 'invalid_code')
  const { codes, hashes } = newRecoveryCodes()
  const db = await getDb()
  await db.update(users).set({ totpEnabledAt: new Date(), recoveryCodes: hashes, updatedAt: new Date() }).where(eq(users.id, user.id))
  await recordAudit({ req, actor: user, action: 'auth.two_factor_enabled', entityType: 'user', entityId: user.id })
  return { recoveryCodes: codes }
}

/** Turns it off, after proving it is really them with a current code or their password. */
const disableTwoFactor = async (req) => {
  const user = await requireUser(req, { staff: true, allowTwoFactorSetup: true })
  if (!user.totpEnabledAt) return { ok: true }
  const secret = decryptSecret(user.totpSecret)
  const proven = (secret && verifyTotp(secret, req.body?.code)) || (req.body?.password && (await verifyPassword(req.body.password, user.passwordHash)))
  if (!proven) fail(400, 'Enter a current code from your app, or your password.', 'invalid_code')
  if (await needsTwoFactorSetupIfOff(user)) fail(403, 'Your role requires two-step sign-in, so it can’t be turned off.', 'required_by_policy')
  const db = await getDb()
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, recoveryCodes: null, updatedAt: new Date() }).where(eq(users.id, user.id))
  await recordAudit({ req, actor: user, action: 'auth.two_factor_disabled', entityType: 'user', entityId: user.id })
  return { ok: true }
}

const needsTwoFactorSetupIfOff = async (user) => needsTwoFactorSetup({ ...user, totpEnabledAt: null })

/** The signed-in person's browsers, newest activity first. */
const listSessions = async (req) => {
  const user = await requireUser(req, { staff: true, allowTwoFactorSetup: true })
  const db = await getDb()
  const current = hashToken(parseCookies(req)[SESSION_COOKIE] || '')
  const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.lastSeenAt))
  return {
    sessions: rows.map((row) => ({
      id: row.id.slice(0, 16),
      current: row.id === current,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      ip: row.ip,
      userAgent: row.userAgent,
    })),
  }
}

/** Signs out one of your other browsers (by the id prefix listed), or all of them. */
const revokeSessions = async (req) => {
  const user = await requireUser(req, { staff: true, allowTwoFactorSetup: true })
  const db = await getDb()
  const current = hashToken(parseCookies(req)[SESSION_COOKIE] || '')
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))
  const target = req.body?.all ? rows.filter((row) => row.id !== current) : rows.filter((row) => row.id.startsWith(text(req.body?.id, 16)) && row.id !== current)
  if (target.length) await db.delete(sessions).where(inArray(sessions.id, target.map((row) => row.id)))
  await recordAudit({ req, actor: user, action: 'auth.sessions_revoked', entityType: 'user', entityId: user.id, detail: { count: target.length } })
  return { revoked: target.length }
}

const logout = async (req, res) => {
  const user = await getSessionUser(req)
  await destroySession(req, res)
  if (user) await recordAudit({ req, actor: user, action: 'auth.logout', entityType: 'user', entityId: user.id })
  return { ok: true }
}

/** Issues a one-time password link. Shared with users.js (invites and admin-triggered resets). */
export const issuePasswordLink = async (req, { user, purpose, actor }) => {
  const db = await getDb()
  const token = newToken()
  const ttl = purpose === 'invite' ? 7 * 24 * 60 * 60 * 1000 : RESET_TTL_MS
  // A new link replaces any outstanding one, so only the latest email works.
  await db.delete(passwordTokens).where(and(eq(passwordTokens.userId, user.id), isNull(passwordTokens.usedAt)))
  await db.insert(passwordTokens).values({
    id: hashToken(token),
    userId: user.id,
    purpose,
    expiresAt: new Date(Date.now() + ttl),
    createdBy: actor?.id ?? null,
  })
  const url = `${appOrigin(req)}/admin/set-password?token=${encodeURIComponent(token)}`
  try {
    await sendPasswordLinkEmail(user.email, {
      name: user.name,
      url,
      purpose,
      invitedBy: actor?.name,
      roleLabel: roleLabel(user.role),
    })
    return { emailed: true, url }
  } catch (error) {
    console.warn(`[auth] could not email ${purpose} link: ${error?.message || error}`)
    return { emailed: false, url }
  }
}

const forgotPassword = async (req) => {
  const email = parseEmail(req.body?.email)
  if (!email) fail(400, 'Enter a valid email address.', 'invalid_input')
  if (!(await underLimit(rateKey('forgot', email), 3, 60 * 60))) {
    fail(429, 'Too many reset requests. Try again later.', 'rate_limited')
  }

  const db = await getDb()
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (user && isStaffRole(user.role) && user.status !== 'disabled') {
    // Someone who never finished their invite gets a fresh invite rather than a "reset".
    await issuePasswordLink(req, { user, purpose: user.status === 'invited' ? 'invite' : 'reset', actor: null })
    await recordAudit({ req, actor: user, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id })
  }
  // Same answer whether or not the account exists.
  return { message: 'If that email belongs to a staff account, we’ve sent a link to set a new password.' }
}

const findPasswordToken = async (token) => {
  if (!token) return null
  const db = await getDb()
  const [row] = await db
    .select({ token: passwordTokens, user: users })
    .from(passwordTokens)
    .innerJoin(users, eq(users.id, passwordTokens.userId))
    .where(
      and(
        eq(passwordTokens.id, hashToken(token)),
        isNull(passwordTokens.usedAt),
        gt(passwordTokens.expiresAt, new Date())
      )
    )
    .limit(1)
  return row && row.user.status !== 'disabled' ? row : null
}

const describePasswordToken = async (req, res, { query }) => {
  const row = await findPasswordToken(query.get('token'))
  if (!row) fail(404, 'This link has expired or has already been used. Ask for a new one.', 'invalid_token')
  return { purpose: row.token.purpose, email: row.user.email, name: row.user.name, role: row.user.role }
}

const setPassword = async (req, res) => {
  const password = req.body?.password
  validatePassword(password)
  const row = await findPasswordToken(req.body?.token)
  if (!row) fail(404, 'This link has expired or has already been used. Ask for a new one.', 'invalid_token')

  const db = await getDb()
  const passwordHash = await hashPassword(password)
  await db.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, row.token.id))
  const [user] = await db
    .update(users)
    .set({ passwordHash, status: 'active', updatedAt: new Date() })
    .where(eq(users.id, row.user.id))
    .returning()

  // Anyone holding an old session loses it when the password changes.
  await destroyUserSessions(user.id)
  await createSession(req, res, user)
  await recordAudit({
    req,
    actor: user,
    action: row.token.purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
    entityType: 'user',
    entityId: user.id,
  })
  return { user: publicUser(user) }
}

/**
 * Customer sign-in with the emailed code (POST /api/otp/request first). Creates the
 * customer record on first use. Staff emails are refused so a staff member cannot end
 * up with a customer session carrying their staff role.
 */
const customerSignIn = async (req, res) => {
  const email = parseEmail(req.body?.email)
  const code = text(req.body?.code, 12)
  if (!email || !code) fail(400, 'Enter your email and the code we sent you.', 'invalid_input')

  const otpError = await checkOtp(email, code)
  if (otpError) fail(otpError.status, otpError.message, 'invalid_code')

  const db = await getDb()
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (user && isStaffRole(user.role)) {
    fail(403, 'This email belongs to a staff account. Sign in on the staff page instead.', 'staff_account')
  }
  if (user?.status === 'disabled') fail(403, 'This account has been disabled.', 'disabled')

  await consumeOtp(email)
  if (!user) {
    ;[user] = await db
      .insert(users)
      .values({ email, name: email.split('@')[0], role: 'customer', status: 'active' })
      .returning()
  }
  // Applications filed under this email before the account existed become theirs.
  await db
    .update(schema.applications)
    .set({ customerId: user.id })
    .where(and(eq(schema.applications.applicantEmail, email), isNull(schema.applications.customerId)))
  await createSession(req, res, user)
  await recordAudit({ req, actor: user, action: 'auth.customer_login', entityType: 'user', entityId: user.id })
  return { user: publicUser(user) }
}

const DEMO_ROLES = Object.keys(ROLES)

// Realistic names read better in a walkthrough than "Demo administrator"; the `is_demo`
// flag (shown as a Demo badge) is what marks them as samples.
const DEMO_NAMES = {
  admin: 'Natasha Kalaba',
  loan_officer: 'Mwila Sakala',
  sales_manager: 'Bwalya Musonda',
  rm: 'Chanda Lungu',
  dsa: 'Kelvin Mbewe',
  customer: 'Thandiwe Phiri',
}

/** The sample user for a role, created on first use. The demo DSA reports to the demo RM so team views have data. */
const ensureDemoUser = async (db, role) => {
  const email = `demo.${role.replace('_', '-')}@demo.los.local`
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing) return existing
  const manager = role === 'dsa' ? await ensureDemoUser(db, 'rm') : null
  const [created] = await db
    .insert(users)
    .values({
      email,
      name: DEMO_NAMES[role] || `Demo ${roleLabel(role).toLowerCase()}`,
      role,
      status: 'active',
      isDemo: true,
      managerId: manager?.id ?? null,
      referralCode: ['dsa', 'rm'].includes(role) ? `DEMO${role.toUpperCase()}` : null,
    })
    .onConflictDoNothing()
    .returning()
  // Lost a race with a parallel first sign-in: read the row the other request wrote.
  return created || (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]
}

/** Signs in as a sample user for a role. Demo users are flagged `is_demo` and never become real accounts. */
const demoSignIn = async (req, res) => {
  if (!demoEnabled()) fail(403, 'Demo access is turned off.', 'demo_disabled')
  const role = req.body?.role
  if (!DEMO_ROLES.includes(role)) fail(400, 'Choose a role to try.', 'invalid_input')

  const db = await getDb()
  const user = await ensureDemoUser(db, role)
  await destroySession(req, res)
  await createSession(req, res, user)
  await recordAudit({ req, actor: user, action: 'auth.demo_login', entityType: 'user', entityId: user.id })
  return { user: publicUser(user) }
}

export const authRoutes = [
  ['GET', '/auth/me', me],
  ['POST', '/auth/login', login],
  ['POST', '/auth/login/verify', verifyLogin],
  ['POST', '/auth/2fa/setup', setupTwoFactor],
  ['POST', '/auth/2fa/enable', enableTwoFactor],
  ['POST', '/auth/2fa/disable', disableTwoFactor],
  ['GET', '/auth/sessions', listSessions],
  ['POST', '/auth/sessions/revoke', revokeSessions],
  ['POST', '/auth/logout', logout],
  ['POST', '/auth/password/forgot', forgotPassword],
  ['GET', '/auth/password/token', describePasswordToken],
  ['POST', '/auth/password/set', setPassword],
  ['POST', '/auth/customer', customerSignIn],
  ['POST', '/auth/demo', demoSignIn],
]
