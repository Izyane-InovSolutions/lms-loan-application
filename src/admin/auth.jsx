import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { isStaffRole, registerRoles } from '@/config/roles'
import { registerStatusLabels } from '@/config/applications'
import { DEFAULT_STAGES_CONFIG } from '@/config/stages'

const AuthContext = createContext(null)

/**
 * Who is signed in, with their role's permissions (`user.permissions`). Loaded once from
 * /auth/me and refreshed after anything that changes the session (sign-in, sign-out,
 * demo role switch) or the roles themselves (Team → Roles).
 *
 * For staff, the workspace's roles and processing stages load too, so custom role names
 * and renamed statuses show wherever roleLabel() and statusLabel() are used.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, demoEnabled: false, roles: [], stages: DEFAULT_STAGES_CONFIG, requireAcceptance: true })

  const refresh = useCallback(async () => {
    try {
      const { user, demoEnabled } = await api('/auth/me')
      let roles = []
      let flow = { stages: DEFAULT_STAGES_CONFIG, requireAcceptance: true }
      if (user && isStaffRole(user.role)) {
        const [loadedRoles, loadedFlow] = await Promise.all([
          api('/roles').then((data) => data.roles).catch(() => []),
          api('/stages').catch(() => flow),
        ])
        roles = loadedRoles
        flow = loadedFlow
        registerRoles(roles)
        registerStatusLabels(flow.stages.labels)
      }
      setState({ status: user ? 'signed-in' : 'signed-out', user, demoEnabled, roles, stages: flow.stages, requireAcceptance: flow.requireAcceptance })
      return user
    } catch {
      setState((prev) => ({ ...prev, status: 'signed-out', user: null }))
      return null
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  /** Returns the user, or { twoFactorRequired, challenge } when a code is needed next. */
  const signIn = useCallback(async (email, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } })
    if (result.twoFactorRequired) return result
    await refresh()
    return result.user
  }, [refresh])

  const verifyTwoFactor = useCallback(async (challenge, code) => {
    const result = await api('/auth/login/verify', { method: 'POST', body: { challenge, code } })
    await refresh()
    return result
  }, [refresh])

  const signInAsDemo = useCallback(async (role) => {
    await api('/auth/demo', { method: 'POST', body: { role } })
    return refresh()
  }, [refresh])

  // After setting a password: the server has started a session; load the full profile.
  const acceptSession = useCallback(() => refresh(), [refresh])

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    setState((prev) => ({ ...prev, status: 'signed-out', user: null }))
  }, [])

  const value = useMemo(
    () => ({ ...state, refresh, signIn, verifyTwoFactor, signInAsDemo, acceptSession, signOut }),
    [state, refresh, signIn, verifyTwoFactor, signInAsDemo, acceptSession, signOut]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
