/* eslint-disable react/prop-types */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { DEFAULT_BRAND_NAME } from '@/config/branding'
import bundledLogo from '@/assets/Icon.png'

/*
 * The product's name and logo (Settings → Branding), for every page. Loaded once from
 * GET /api/v1/branding; the last answer is kept in this browser so a returning visitor
 * doesn't see the default flash up before the configured brand.
 */

const STORAGE_KEY = 'los:branding'
const DEFAULTS = { name: DEFAULT_BRAND_NAME, logoUrl: null }
// index.html's own icon, restored when a custom logo is removed.
const BUNDLED_FAVICON = '/assets/favicon.png'

const readCached = () => {
  try {
    const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    return cached?.name ? { name: cached.name, logoUrl: cached.logoUrl || null } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

const BrandingContext = createContext({ ...DEFAULTS, logoSrc: bundledLogo, customLogo: false, refresh: async () => {} })

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(readCached)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/branding', { credentials: 'same-origin' })
      if (!response.ok) return
      const next = await response.json()
      if (!next?.name) return
      setBranding({ name: next.name, logoUrl: next.logoUrl || null })
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: next.name, logoUrl: next.logoUrl || null }))
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

  const value = useMemo(() => ({ ...branding, logoSrc, customLogo: Boolean(branding.logoUrl), refresh }), [branding, logoSrc, refresh])
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

/** { name, logoSrc, customLogo, refresh } */
export const useBranding = () => useContext(BrandingContext)
