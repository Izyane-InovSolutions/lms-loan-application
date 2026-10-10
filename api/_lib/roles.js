import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text } from './http.js'
import { ADMIN_PERMISSIONS, BUILT_IN_ROLES, SCOPES, isPermission } from '../../src/config/roles.js'
import { getSetting, setSetting } from './settings.js'

const { roles, users } = schema

/*
 * The workspace's roles: the built-ins (src/config/roles.js) with any changes an admin
 * saved, then custom roles. Read on every staff request, so cached briefly — a change
 * applies at once on this instance (the cache is cleared) and within half a minute on
 * any other.
 *
 * Administrators always hold every permission but the ones that bring business in
 * (ADMIN_EXCLUDED_PERMISSIONS), and see everything, so no configuration can lock the
 * workspace out of its own settings.
 */

const TTL_MS = 30 * 1000
let cache = { at: 0, list: null }

export const clearRolesCache = () => {
  cache = { at: 0, list: null }
}

const cleanPermissions = (list) => [...new Set((Array.isArray(list) ? list : []).filter(isPermission))]

const fromBuiltIn = (key, row) => {
  const defaults = BUILT_IN_ROLES[key]
  if (key === 'admin') return { key, builtIn: true, locked: true, customized: false, ...defaults, permissions: [...ADMIN_PERMISSIONS] }
  return {
    key,
    builtIn: true,
    locked: false,
    customized: Boolean(row),
    label: row?.label || defaults.label,
    description: row?.description ?? defaults.description,
    scope: SCOPES[row?.scope] ? row.scope : defaults.scope,
    permissions: row ? cleanPermissions(row.permissions) : [...defaults.permissions],
  }
}

const fromCustom = (row) => ({
  key: row.key,
  builtIn: false,
  locked: false,
  customized: true,
  label: row.label,
  description: row.description || '',
  scope: SCOPES[row.scope] ? row.scope : 'own',
  permissions: cleanPermissions(row.permissions),
})

/** Built-in roles an admin deleted; never the administrator. */
const removedBuiltIns = async () => ((await getSetting('removedRoles')).keys || []).filter((key) => BUILT_IN_ROLES[key] && key !== 'admin')

/** The deleted built-in roles, to bring back on the Roles page. */
export const listRemovedRoles = async () => (await removedBuiltIns()).map((key) => ({ key, label: BUILT_IN_ROLES[key].label, description: BUILT_IN_ROLES[key].description }))

/** Every staff role, built-ins first. */
export const listRoles = async () => {
  if (cache.list && Date.now() - cache.at < TTL_MS) return cache.list
  const db = await getDb()
  const [rows, removed] = await Promise.all([db.select().from(roles), removedBuiltIns()])
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
  const list = [
    ...Object.keys(BUILT_IN_ROLES)
      .filter((key) => !removed.includes(key))
      .map((key) => fromBuiltIn(key, byKey[key])),
    ...rows.filter((row) => !BUILT_IN_ROLES[row.key]).map(fromCustom).sort((a, b) => a.label.localeCompare(b.label)),
  ]
  cache = { at: Date.now(), list }
  return list
}

export const getRole = async (key) => (await listRoles()).find((role) => role.key === key) || null

/** Keys of the roles that hold a permission, for queries such as "every active officer". */
export const rolesWith = async (permission) => (await listRoles()).filter((role) => role.permissions.includes(permission)).map((role) => role.key)

export const roleHas = async (key, permission) => Boolean((await getRole(key))?.permissions.includes(permission))

const SCOPE_RANK = { own: 0, team: 1, all: 2 }

/**
 * True when `role` gives nothing `actor` lacks: each of its permissions, and a scope no
 * wider than theirs. Holding users.manage or roles.manage lets someone share what they
 * have, never hand out (to themselves or anyone) more — administrators remain the only way
 * to grant anything. They may grant even what they don't hold themselves (bringing
 * business in, ADMIN_EXCLUDED_PERMISSIONS): it's left off them by design, not for want of
 * authority.
 */
export const roleWithin = (actor, role) =>
  Boolean(actor && role) &&
  (actor.role === 'admin' ||
    (role.permissions.every((permission) => actor.permissions?.includes(permission)) && (SCOPE_RANK[role.scope] ?? 0) <= (SCOPE_RANK[actor.scope] ?? 0)))

/** Throws a 403 unless `roleWithin(actor, role)`. */
export const assertRoleWithin = (actor, role, message = 'You can only manage roles that have no more access than your own.') => {
  if (!roleWithin(actor, role)) fail(403, message, 'beyond_own_access')
}

/**
 * A user with their role resolved: `permissions`, `scope` and `roleLabel`. Customers have
 * no staff permissions; a staff member whose role no longer exists has none either.
 */
export const withPermissions = async (user) => {
  if (!user) return user
  if (user.role === 'customer') return { ...user, permissions: [], scope: 'own', roleLabel: 'Customer' }
  const role = await getRole(user.role)
  return { ...user, permissions: role ? [...role.permissions] : [], scope: role?.scope || 'own', roleLabel: role?.label || user.role }
}

// ---------------------------------------------------------------------------
// Changing roles (Team → Roles)
// ---------------------------------------------------------------------------

const RESERVED_KEYS = new Set(['customer', 'system', 'self'])

const parseRoleInput = (input, { partial = false } = {}) => {
  const changes = {}
  if (!partial || input.label !== undefined) {
    const label = text(input.label, 60)
    if (label.length < 2) fail(400, 'Give the role a name.', 'invalid_input')
    changes.label = label
  }
  if (input.description !== undefined) changes.description = text(input.description, 300) || null
  if (!partial || input.scope !== undefined) {
    if (!SCOPES[input.scope]) fail(400, 'Choose which applications the role sees.', 'invalid_input')
    changes.scope = input.scope
  }
  if (!partial || input.permissions !== undefined) {
    if (!Array.isArray(input.permissions)) fail(400, 'Choose the role’s permissions.', 'invalid_input')
    const unknown = input.permissions.filter((key) => !isPermission(key))
    if (unknown.length) fail(400, `Unknown permission: ${unknown.join(', ')}.`, 'invalid_input')
    changes.permissions = cleanPermissions(input.permissions)
  }
  return changes
}

const slugFor = (label) =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'role'

/** Adds a custom role. Its key is made from the name and never changes. */
export const createRole = async (input, actor) => {
  const values = parseRoleInput(input)
  assertRoleWithin(actor, values, 'A new role can’t have more access than your own.')
  const existing = await listRoles()
  const base = slugFor(values.label)
  let key = base
  for (let n = 2; existing.some((role) => role.key === key) || RESERVED_KEYS.has(key); n += 1) key = `${base}_${n}`
  const db = await getDb()
  await db.insert(roles).values({ key, ...values, updatedBy: actor?.id ?? null })
  clearRolesCache()
  return getRole(key)
}

/** Changes a role. The administrator role is fixed. `check(next)` may refuse the result before it is saved. */
export const updateRole = async (key, input, actor, { check } = {}) => {
  const current = await getRole(key)
  if (!current) fail(404, 'Role not found.', 'not_found')
  if (current.locked) fail(403, 'The administrator role’s permissions are fixed.', 'locked_role')
  assertRoleWithin(actor, current)
  const changes = parseRoleInput(input, { partial: true })
  const next = { label: current.label, description: current.description || null, scope: current.scope, permissions: current.permissions, ...changes }
  assertRoleWithin(actor, next, 'A role can’t be given more access than your own.')
  if (check) await check({ key, ...next })
  const db = await getDb()
  await db
    .insert(roles)
    .values({ key, ...next, updatedBy: actor?.id ?? null })
    .onConflictDoUpdate({ target: roles.key, set: { ...next, updatedBy: actor?.id ?? null, updatedAt: new Date() } })
  clearRolesCache()
  return { before: current, after: await getRole(key) }
}

/** Restores a built-in role's defaults. `check(next)` may refuse them before they apply. */
export const resetRole = async (key, actor, { check } = {}) => {
  const current = await getRole(key)
  if (!current?.builtIn) fail(404, 'Only built-in roles can be reset.', 'not_found')
  if (current.locked) fail(403, 'The administrator role’s permissions are fixed.', 'locked_role')
  assertRoleWithin(actor, current)
  assertRoleWithin(actor, fromBuiltIn(key, null), 'This role’s defaults have more access than your own, so only an administrator can reset it.')
  if (check) await check(fromBuiltIn(key, null))
  const db = await getDb()
  await db.delete(roles).where(eq(roles.key, key))
  clearRolesCache()
  return { before: current, after: await getRole(key) }
}

/**
 * Deletes a role nobody holds: a custom role for good, a built-in one by hiding it until
 * it is restored (restoreRole). The administrator role can't be deleted. `check` refuses
 * when the workflow still names the role (api/_handlers/roles.js).
 */
export const deleteRole = async (key, actor, { check } = {}) => {
  const current = await getRole(key)
  if (!current) fail(404, 'Role not found.', 'not_found')
  if (current.locked) fail(403, 'The administrator role can’t be deleted.', 'locked_role')
  assertRoleWithin(actor, current)
  const db = await getDb()
  // Invited and switched-off members count too: deleting the role would strand them. Deleted accounts don't.
  const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(users).where(and(eq(users.role, key), ne(users.status, 'deleted')))
  if (count > 0) fail(409, `${count} ${count === 1 ? 'person has' : 'people have'} this role. Give them another role first.`, 'role_in_use')
  if (check) await check(current)

  // A built-in role's saved changes go with it, so a restore starts from its defaults.
  await db.delete(roles).where(eq(roles.key, key))
  if (current.builtIn) await setSetting('removedRoles', { keys: [...new Set([...(await removedBuiltIns()), key])] }, actor)
  // Nobody can be asked for two-step sign-in by a role that no longer exists.
  const security = await getSetting('security')
  if ((security.requireTwoFactorRoles || []).includes(key)) {
    await setSetting('security', { requireTwoFactorRoles: security.requireTwoFactorRoles.filter((entry) => entry !== key) }, actor)
  }
  clearRolesCache()
  return current
}

/** Brings back a deleted built-in role, with its default permissions. */
export const restoreRole = async (key, actor) => {
  const removed = await removedBuiltIns()
  if (!removed.includes(key)) fail(404, 'That role hasn’t been deleted.', 'not_found')
  await setSetting('removedRoles', { keys: removed.filter((entry) => entry !== key) }, actor)
  clearRolesCache()
  return getRole(key)
}

/** How many people hold each role, for the Roles page. */
export const roleMemberCounts = async () => {
  const db = await getDb()
  const rows = await db.select({ role: users.role, count: sql`count(*)::int` }).from(users).where(sql`${users.status} <> 'disabled'`).groupBy(users.role)
  return Object.fromEntries(rows.map((row) => [row.role, row.count]))
}
