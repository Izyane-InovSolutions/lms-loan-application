import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text, email as parseEmail } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { destroyUserSessions, publicUser } from '../_lib/auth/sessions.js'
import { newReferralCode } from '../_lib/auth/tokens.js'
import { issuePasswordLink } from './auth.js'
import { isStaffRole } from '../../src/config/roles.js'
import { can } from '../_lib/rbac.js'
import { getRole, roleHas, rolesWith } from '../_lib/roles.js'

const { users } = schema
const manager = alias(users, 'manager')

// Anyone whose role brings business in carries a referral code.
const refers = (role) => roleHas(role, 'applications.assist')

// Who may have a manager: people who bring business in without leading a team (DSAs, by default).
const takesManager = async (role) => (await refers(role)) && !(await roleHas(role, 'team.lead'))

/** Throws unless `role` is an existing staff role. */
const assertStaffRole = async (role) => {
  if (!isStaffRole(role) || !(await getRole(role))) fail(400, 'Choose a staff role.', 'invalid_input')
}

/**
 * The band of loan amounts a person may finally approve. A blank maximum means no upper
 * limit. Returns only the fields the request actually sent, and checks max >= min against
 * whatever the record already holds for the field that is not being changed.
 */
const parseApprovalBand = (body, current) => {
  const toAmount = (raw, label) => {
    if (raw === '' || raw === null || raw === undefined) return null
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) fail(400, `${label} must be a whole number of 0 or more.`, 'invalid_input')
    return value
  }
  const changes = {}
  if (body.approvalMin !== undefined) changes.approvalMin = toAmount(body.approvalMin, 'The minimum approval amount') ?? 0
  if (body.approvalMax !== undefined) changes.approvalMax = toAmount(body.approvalMax, 'The maximum approval amount')
  const min = changes.approvalMin ?? current?.approvalMin ?? 0
  const max = changes.approvalMax !== undefined ? changes.approvalMax : current?.approvalMax ?? null
  if (max != null && max < min) fail(400, 'The maximum approval amount cannot be less than the minimum.', 'invalid_input')
  return changes
}

const userColumns = {
  user: users,
  managerName: manager.name,
}

const toListItem = ({ user, managerName }) => ({ ...publicUser(user), managerName: managerName ?? null })

/**
 * Which users someone with users.view may list:
 *   users.manage   everyone, customers included when asked for
 *   scope "all"    all staff
 *   otherwise      themselves and the people who report to them
 */
const visibilityFilter = (viewer) => {
  if (can(viewer, 'users.manage')) return undefined
  if (viewer.scope === 'all') return ne(users.role, 'customer')
  return or(eq(users.id, viewer.id), eq(users.managerId, viewer.id))
}

const listUsers = async (req, res, { query }) => {
  const viewer = await requireUser(req, { permission: 'users.view' })
  const db = await getDb()

  const role = query.get('role')
  const status = query.get('status')
  const search = text(query.get('q'), 100)

  const filters = [visibilityFilter(viewer)]
  if (role && (role === 'customer' || (await getRole(role)))) filters.push(eq(users.role, role))
  // Customers are only listed when asked for by name; the directory is about staff.
  else filters.push(ne(users.role, 'customer'))
  if (status) filters.push(eq(users.status, status))
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`
    filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern)))
  }

  const rows = await db
    .select(userColumns)
    .from(users)
    .leftJoin(manager, eq(manager.id, users.managerId))
    .where(and(...filters.filter(Boolean)))
    .orderBy(asc(users.status), desc(users.createdAt))
    .limit(500)

  return { users: rows.map(toListItem) }
}

/** Throws unless `managerId` is an active team lead (a relationship manager, by default). */
const assertManager = async (db, managerId) => {
  const [candidate] = await db.select().from(users).where(eq(users.id, managerId)).limit(1)
  if (!candidate || candidate.status === 'disabled' || !(await roleHas(candidate.role, 'team.lead'))) {
    fail(400, 'Choose an active relationship manager.', 'invalid_manager')
  }
}

const uniqueReferralCode = async (db) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newReferralCode()
    const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1)
    if (!clash) return code
  }
  throw new Error('Could not allocate a unique referral code.')
}

const inviteUser = async (req) => {
  const actor = await requireUser(req, { permission: 'users.manage' })
  const db = await getDb()

  const name = text(req.body?.name, 100)
  const email = parseEmail(req.body?.email)
  const role = req.body?.role
  const phone = text(req.body?.phone, 30) || null

  if (name.length < 2) fail(400, 'Enter the person’s full name.', 'invalid_input')
  if (!email) fail(400, 'Enter a valid email address.', 'invalid_input')
  await assertStaffRole(role)
  const managerId = (await takesManager(role)) ? req.body?.managerId || null : null
  if (managerId) await assertManager(db, managerId)

  const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) {
    fail(
      409,
      existing.role === 'customer'
        ? 'This email is registered as a customer. Staff need a separate work email.'
        : 'Someone with this email already has an account.',
      'email_taken'
    )
  }

  const band = parseApprovalBand(req.body || {}, null)

  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      role,
      phone,
      managerId,
      status: 'invited',
      referralCode: (await refers(role)) ? await uniqueReferralCode(db) : null,
      createdBy: actor.id,
      ...band,
    })
    .returning()

  const link = await issuePasswordLink(req, { user, purpose: 'invite', actor })
  await recordAudit({
    req,
    actor,
    action: 'user.invited',
    entityType: 'user',
    entityId: user.id,
    detail: { email, role, managerId, emailed: link.emailed },
  })

  // The link is only handed to the admin when the email did not go out, so they can
  // pass it on themselves. Returning it every time would let an admin set a colleague's
  // password and act as them.
  return { user: publicUser(user), emailed: link.emailed, inviteUrl: link.emailed ? undefined : link.url }
}

const EDITABLE_STATUSES = ['active', 'disabled']

const updateUser = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'users.manage' })
  const db = await getDb()
  const [target] = await db.select().from(users).where(eq(users.id, params.id)).limit(1)
  if (!target) fail(404, 'User not found.', 'not_found')

  const body = req.body || {}
  const changes = {}

  if (body.name !== undefined) {
    const name = text(body.name, 100)
    if (name.length < 2) fail(400, 'Enter the person’s full name.', 'invalid_input')
    changes.name = name
  }
  if (body.phone !== undefined) changes.phone = text(body.phone, 30) || null
  // For a lost phone: they sign in with their password and set it up again.
  if (body.resetTwoFactor === true) {
    if (target.id === actor.id) fail(400, 'Turn off your own two-step sign-in from your profile.', 'self_change')
    Object.assign(changes, { totpSecret: null, totpEnabledAt: null, recoveryCodes: null })
  }

  if (body.role !== undefined && body.role !== target.role) {
    if (!isStaffRole(target.role)) fail(400, 'Choose a staff role.', 'invalid_input')
    await assertStaffRole(body.role)
    if (target.id === actor.id) fail(400, 'You can’t change your own role.', 'self_change')
    changes.role = body.role
    if ((await refers(body.role)) && !target.referralCode) changes.referralCode = await uniqueReferralCode(db)
  }

  const nextRole = changes.role || target.role
  if (body.managerId !== undefined || changes.role) {
    const managerId = (await takesManager(nextRole)) ? body.managerId ?? target.managerId ?? null : null
    if (managerId) {
      if (managerId === target.id) fail(400, 'Someone can’t be their own manager.', 'invalid_manager')
      await assertManager(db, managerId)
    }
    changes.managerId = managerId
  }

  if (body.status !== undefined && body.status !== target.status) {
    if (!EDITABLE_STATUSES.includes(body.status)) fail(400, 'Unknown status.', 'invalid_input')
    if (target.id === actor.id) fail(400, 'You can’t disable your own account.', 'self_change')
    // Re-enabling someone who never set a password puts them back to "invited", not active.
    changes.status = body.status === 'active' && !target.passwordHash ? 'invited' : body.status
  }

  Object.assign(changes, parseApprovalBand(body, target))

  if (!Object.keys(changes).length) return { user: publicUser(target) }

  const [user] = await db
    .update(users)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(users.id, target.id))
    .returning()

  // A disabled account, or a changed role, must not keep using a session granted under the old terms.
  if (changes.status === 'disabled' || changes.role || body.resetTwoFactor === true) await destroyUserSessions(user.id)

  // Secrets never go into the audit trail; a reset is recorded as a flag.
  const auditable = Object.keys(changes).filter((key) => !['totpSecret', 'recoveryCodes', 'totpEnabledAt'].includes(key))
  const before = Object.fromEntries(auditable.map((key) => [key, target[key] ?? null]))
  if (body.resetTwoFactor === true) before.twoFactor = Boolean(target.totpEnabledAt)
  const after = Object.fromEntries(auditable.map((key) => [key, changes[key]]))
  if (body.resetTwoFactor === true) after.twoFactor = false
  await recordAudit({ req, actor, action: 'user.updated', entityType: 'user', entityId: user.id, detail: { before, after } })
  return { user: publicUser(user) }
}

/** Resends an invite, or sends a reset link to someone already active. */
const sendPasswordLink = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'users.manage' })
  const db = await getDb()
  const [user] = await db.select().from(users).where(eq(users.id, params.id)).limit(1)
  if (!user || !isStaffRole(user.role)) fail(404, 'User not found.', 'not_found')
  if (user.status === 'disabled') fail(400, 'Enable the account before sending a link.', 'disabled')

  const purpose = user.status === 'invited' ? 'invite' : 'reset'
  const link = await issuePasswordLink(req, { user, purpose, actor })
  await recordAudit({
    req,
    actor,
    action: purpose === 'invite' ? 'user.invite_resent' : 'user.password_reset_sent',
    entityType: 'user',
    entityId: user.id,
    detail: { emailed: link.emailed },
  })
  return { emailed: link.emailed, purpose, inviteUrl: link.emailed ? undefined : link.url }
}

/** Active team leads, for the "reports to" picker. */
const listManagers = async (req) => {
  await requireUser(req, { permission: 'users.manage' })
  const db = await getDb()
  const leadRoles = await rolesWith('team.lead')
  if (!leadRoles.length) return { managers: [] }
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(inArray(users.role, leadRoles), ne(users.status, 'disabled')))
    .orderBy(asc(users.name))
  return { managers: rows }
}

/** Head-counts for the admin overview. */
export const userCounts = async (db, { includeDemo = false } = {}) => {
  const rows = await db
    .select({ role: users.role, status: users.status, count: sql`count(*)::int` })
    .from(users)
    .where(includeDemo ? undefined : eq(users.isDemo, false))
    .groupBy(users.role, users.status)
  return rows
}

export const userRoutes = [
  ['GET', '/users', listUsers],
  ['POST', '/users', inviteUser],
  ['GET', '/users/managers', listManagers],
  ['PATCH', '/users/:id', updateUser],
  ['POST', '/users/:id/password-link', sendPasswordLink],
]
