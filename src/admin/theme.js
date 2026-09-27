import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'los-admin-theme'

// Storage can be unavailable (private windows, blocked site data); the theme then just
// follows the system for this visit.
const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const systemPrefersDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

/**
 * Light/dark for the staff workspace. Applies the `dark` class to <html> while the
 * workspace is mounted and removes it on the way out, so the public site keeps its
 * own light theme.
 */
export function useWorkspaceTheme() {
  const [theme, setTheme] = useState(() => readStored() || (systemPrefersDark() ? 'dark' : 'light'))

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    return () => root.classList.remove('dark')
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Not persisted; still applied for this visit.
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
