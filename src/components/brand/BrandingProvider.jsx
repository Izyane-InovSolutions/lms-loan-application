/* eslint-disable react/prop-types */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { DEFAULT_BRAND_NAME } from '@/config/branding'
import { DEFAULT_THEME, normaliseTheme } from '@/config/theme'
import { applyTheme } from '@/lib/applyTheme'
import bundledLogo from '@/assets/Icon.png'

/*
 * The product's name, logo and theme (Settings → Branding), for every page. Loaded once
 * from GET /api/v1/branding; the last answer is kept in this browser so a returning
 * visitor doesn't see the default flash up before the configured brand.
 *
 * Settings can preview a theme before saving it (previewTheme); leaving the page, or
 * passing null, puts the saved theme back.
 */

const STORAGE_KEY = 'los:branding'
const NO_CONTACT = { address: '', phone: '', email: '', website: '' }
const DEFAULTS = { name: DEFAULT_BRAND_NAME, logoUrl: null, contact: NO_CONTACT, theme: DEFAULT_THEME }
// The public contacts (Settings → Branding → Letterhead), each a trimmed string.
const readContact = (contact) => ({ ...NO_CONTACT, ...Object.fromEntries(Object.entries(contact || {}).filter(([key]) => key in NO_CONTACT).map(([key, value]) => [key, String(value || '').trim()])) })
// index.html's own icon, restored when a custom logo is removed.
const BUNDLED_FAVICON = '/assets/favicon.png'

const readCached = () => {
  try {
    const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    return cached?.name ? { name: cached.name, logoUrl: cached.logoUrl || null, contact: readContact(cached.contact), theme: normaliseTheme(cached.theme) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

const BrandingContext = createContext({ ...DEFAULTS, logoSrc: bundledLogo, customLogo: false, refresh: async () => {}, previewTheme: () => {} })

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(readCached)
  const [preview, setPreview] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/branding', { credentials: 'same-origin' })
      if (!response.ok) return
      const next = await response.json()
      if (!next?.name) return
      const loaded = { name: next.name, logoUrl: next.logoUrl || null, contact: readContact(next.contact), theme: normaliseTheme(next.theme) }
      setBranding(loaded)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded))
      } catch {
        // Storage blocked: the brand still loads on every visit.
      }
    } catch {
      // Offline or the API is down: keep what we have.
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The saved theme, or the one being previewed; only the saved one is remembered.
  useEffect(() => {
    applyTheme(preview || branding.theme, { remember: !preview })
  }, [branding.theme, preview])

  const previewTheme = useCallback((theme) => setPreview(theme ? normaliseTheme(theme) : null), [])

  const logoSrc = branding.logoUrl || bundledLogo

  // The tab title and icon follow the brand too.
  useEffect(() => {
    document.title = `Loan Application — ${branding.name}`
    const icon = document.querySelector('link[rel="icon"]')
    if (!icon) return
    if (branding.logoUrl) {
      icon.setAttribute('href', branding.logoUrl)
      icon.removeAttribute('type')
    } else {
      icon.setAttribute('href', BUNDLED_FAVICON)
      icon.setAttribute('type', 'image/png')
    }
  }, [branding.name, branding.logoUrl])

  const value = useMemo(
    () => ({ ...branding, logoSrc, customLogo: Boolean(branding.logoUrl), refresh, previewTheme }),
    [branding, logoSrc, refresh, previewTheme]
  )
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

/** { name, logoSrc, customLogo, contact, theme, refresh, previewTheme } */
export const useBranding = () => useContext(BrandingContext)
