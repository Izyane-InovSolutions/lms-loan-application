import { getSetting } from '../settings.js'

/*
 * Which staff must use two-step sign-in (Settings → Security). Read on every staff
 * request, so it is cached briefly: a change applies within half a minute.
 */

let cache = { at: 0, roles: [] }
const TTL_MS = 30 * 1000

export const rolesRequiringTwoFactor = async () => {
  if (Date.now() - cache.at > TTL_MS) {
    const { requireTwoFactorRoles } = await getSetting('security').catch(() => ({ requireTwoFactorRoles: [] }))
    cache = { at: Date.now(), roles: requireTwoFactorRoles || [] }
  }
  return cache.roles
}

export const clearTwoFactorCache = () => {
  cache = { at: 0, roles: [] }
}

/** True when this person's role requires two-step sign-in and they have not set it up. */
export const needsTwoFactorSetup = async (user) =>
  !user.totpEnabledAt && !user.isDemo && (await rolesRequiringTwoFactor()).includes(user.role)
