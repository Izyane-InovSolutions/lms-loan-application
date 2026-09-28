import { getSessionUser } from './auth/sessions.js'
import { needsTwoFactorSetup } from './auth/twoFactor.js'
import { fail } from './http.js'
import { can, isStaffRole } from '../../src/config/roles.js'

/**
 * The signed-in user, or a 401/403.
 *
 *   requireUser(req)                           anyone signed in
 *   requireUser(req, { staff: true })          staff roles only
 *   requireUser(req, { roles: ['admin'] })     one of these roles
 *   requireUser(req, { permission: 'x.y' })    a role granted that permission in roles.js
 *
 * Staff whose role must use two-step sign-in (Settings → Security) and have not set it
 * up are refused everything except setting it up (`allowTwoFactorSetup`).
 */
export const requireUser = async (req, { staff = false, roles, permission, allowTwoFactorSetup = false } = {}) => {
  const user = await getSessionUser(req)
  if (!user) fail(401, 'Please sign in to continue.', 'unauthenticated')
  if (!allowTwoFactorSetup && isStaffRole(user.role) && (await needsTwoFactorSetup(user))) {
    fail(403, 'Set up two-step sign-in to continue.', 'two_factor_setup_required')
  }
  if (staff && !isStaffRole(user.role)) fail(403, 'This area is for staff.', 'forbidden')
  if (roles && !roles.includes(user.role)) fail(403, 'Your role does not have access to this.', 'forbidden')
  if (permission && !can(user.role, permission)) fail(403, 'Your role does not have access to this.', 'forbidden')
  return user
}
