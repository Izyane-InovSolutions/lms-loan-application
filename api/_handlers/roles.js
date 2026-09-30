import { can, requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { createRole, deleteRole, listRoles, resetRole, roleMemberCounts, updateRole } from '../_lib/roles.js'

/*
 * Team → Roles. Every staff member may read the list (the workspace shows role names
 * everywhere); changing it needs roles.manage. Changes apply to everyone holding the role
 * on their next request, without signing anyone out.
 */

const summary = (role) => ({ label: role.label, scope: role.scope, permissions: role.permissions })

const list = async (req) => {
  const viewer = await requireUser(req, { staff: true })
  const roles = await listRoles()
  const counts = can(viewer, 'roles.manage') ? await roleMemberCounts() : null
  return { roles: roles.map((role) => ({ ...role, ...(counts ? { members: counts[role.key] || 0 } : {}) })) }
}

const create = async (req) => {
  const actor = await requireUser(req, { permission: 'roles.manage' })
  const role = await createRole(req.body || {}, actor)
  await recordAudit({ req, actor, action: 'role.created', entityType: 'role', entityId: null, detail: { key: role.key, ...summary(role) } })
  return { role }
}

const update = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'roles.manage' })
  const { before, after } = await updateRole(params.key, req.body || {}, actor)
  await recordAudit({ req, actor, action: 'role.updated', entityType: 'role', entityId: null, detail: { key: params.key, before: summary(before), after: summary(after) } })
  return { role: after }
}

const reset = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'roles.manage' })
  const { before, after } = await resetRole(params.key)
  await recordAudit({ req, actor, action: 'role.reset', entityType: 'role', entityId: null, detail: { key: params.key, before: summary(before), after: summary(after) } })
  return { role: after }
}

const remove = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'roles.manage' })
  const removed = await deleteRole(params.key)
  await recordAudit({ req, actor, action: 'role.deleted', entityType: 'role', entityId: null, detail: { key: params.key, ...summary(removed) } })
  return { ok: true }
}

export const roleRoutes = [
  ['GET', '/roles', list],
  ['POST', '/roles', create],
  ['PATCH', '/roles/:key', update],
  ['POST', '/roles/:key/reset', reset],
  ['DELETE', '/roles/:key', remove],
]
