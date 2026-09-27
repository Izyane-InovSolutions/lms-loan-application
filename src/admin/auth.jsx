import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'

const AuthContext = createContext(null)

/**
 * Who is signed in. Loaded once from /auth/me and refreshed after anything that changes
 * the session (sign-in, sign-out, demo role switch).
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, demoEnabled: false })

  const refresh = useCallback(async () => {
    try {
      const { user, demoEnabled } = await api('/auth/me')
      setState({ status: user ? 'signed-in' : 'signed-out', user, demoEnabled })
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
