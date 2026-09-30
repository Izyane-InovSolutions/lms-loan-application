import { getSessionUser } from './auth/sessions.js'
import { needsTwoFactorSetup } from './auth/twoFactor.js'
import { fail } from './http.js'
import { isStaffRole } from '../../src/config/roles.js'

/** Whether a signed-in user (from getSessionUser) holds a permission. */
export const can = (user, permission) => Boolean(user?.permissions?.includes(permission))

/** Throws a 403 unless the user holds the permission. */
export const requirePermission = (user, permission, message = 'Your role does not have access to this.') => {
  if (!can(user, permission)) fail(403, message, 'forbidden')
}

/**
 * The signed-in user, or a 401/403.
 *
 *   requireUser(req)                              anyone signed in
 *   requireUser(req, { staff: true })             staff only
 *   requireUser(req, { roles: ['customer'] })     one of these roles
 *   requireUser(req, { permission: 'x.y' })       staff whose role grants the permission (roles.js)
 *   requireUser(req, { anyPermission: [...] })    staff whose role grants at least one
 *
 * Staff whose role must use two-step sign-in (Settings → Security) and have not set it
 * up are refused everything except setting it up (`allowTwoFactorSetup`).
 */
export const requireUser = async (req, { staff = false, roles, permission, anyPermission, allowTwoFactorSetup = false } = {}) => {
  const user = await getSessionUser(req)
  if (!user) fail(401, 'Please sign in to continue.', 'unauthenticated')
  if (!allowTwoFactorSetup && isStaffRole(user.role) && (await needsTwoFactorSetup(user))) {
    fail(403, 'Set up two-step sign-in to continue.', 'two_factor_setup_required')
  }
  if (staff && !isStaffRole(user.role)) fail(403, 'This area is for staff.', 'forbidden')
  if (roles && !roles.includes(user.role)) fail(403, 'Your role does not have access to this.', 'forbidden')
  if (permission) requirePermission(user, permission)
  if (anyPermission && !anyPermission.some((key) => can(user, key))) fail(403, 'Your role does not have access to this.', 'forbidden')
  return user
}

