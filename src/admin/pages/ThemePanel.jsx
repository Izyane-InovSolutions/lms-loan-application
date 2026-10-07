/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react'
import { Check, Loader2, Mail, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useBranding } from '@/components/brand/BrandingProvider'
import { DEFAULT_THEME, FONT_OPTIONS, PRESET_COLOURS, RADIUS_OPTIONS, SIDEBAR_STYLES, isHexColour, normaliseTheme, takesWhiteText, themeTokens } from '@/config/theme'
import { api } from '../api'
import { FormError, Panel } from '../components'

const same = (a, b) => JSON.stringify(normaliseTheme(a)) === JSON.stringify(normaliseTheme(b))

/**
 * Settings → Branding → Theme: the accent colour, sidebar, corners and font of the whole
 * system — the workspace, the application site, emails and generated documents
 * (src/config/theme.js). Changes preview live across the page before they're saved;
 * leaving without saving puts the saved theme back.
 */
export function ThemePanel({ initial, notify }) {
  const branding = useBranding()
  const [theme, setTheme] = useState(() => normaliseTheme(initial))
  const [saved, setSaved] = useState(() => normaliseTheme(initial))
  // The hex field as typed, which may be half-finished.
  const [hex, setHex] = useState(() => normaliseTheme(initial).colour)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = !same(theme, saved)

  useEffect(() => {
    const next = normaliseTheme(initial)
    setTheme(next)
    setSaved(next)
    setHex(next.colour)
  }, [initial])

  // Preview the unsaved theme everywhere on the page; put the saved one back on leaving.
  const { previewTheme } = branding
  useEffect(() => {
    previewTheme(dirty ? theme : null)
  }, [dirty, theme, previewTheme])
  useEffect(() => () => previewTheme(null), [previewTheme])

  const set = (changes) => setTheme((prev) => normaliseTheme({ ...prev, ...changes }))
  const pickColour = (colour) => {
    setHex(colour)
    set({ colour })
  }
  const resetTo = (next) => {
    setTheme(normaliseTheme(next))
    setHex(normaliseTheme(next).colour)
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await api('/settings/branding', { method: 'PUT', body: theme })
      const next = normaliseTheme(response.branding)
      setSaved(next)
      setTheme(next)
      await branding.refresh()
      notify('Theme saved: the workspace, emails and new documents use it now')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  const lightAccent = !takesWhiteText(theme.colour)

  return (
    <Panel
      title="Theme"
      description="The look of the whole system: this workspace, the application site, emails and generated documents. Changes preview live on this page; save to apply them for everyone."
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-7">
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Accent colour</legend>
            <p className="mt-0.5 text-xs text-muted-foreground">Buttons, links, highlights, the sidebar, email headers and document letterheads.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESET_COLOURS.map((preset) => {
                const active = theme.colour === preset.colour
                return (
                  <button
                    key={preset.colour}
                    type="button"
                    onClick={() => pickColour(preset.colour)}
                    aria-pressed={active}
                    title={preset.label}
                    className={cn(
                      'grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active && 'ring-2 ring-foreground'
                    )}
                    style={{ background: preset.colour }}
                  >
                    {active ? <Check className="size-4 text-white" aria-hidden="true" /> : null}
                    <span className="sr-only">{preset.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex max-w-xs items-center gap-2">
              <input
                type="color"
                aria-label="Pick any colour"
                value={theme.colour}
                onChange={(event) => pickColour(event.target.value)}
                className="h-10 w-12 cursor-pointer rounded-md border bg-background p-1"
              />
              <Input
                aria-label="Accent colour as a hex value"
                value={hex}
                maxLength={7}
                className="font-mono"
                onChange={(event) => {
                  const value = event.target.value.trim()
                  setHex(value)
                  if (isHexColour(value)) set({ colour: value })
                }}
              />
            </div>
            {lightAccent ? <p className="mt-2 text-xs text-warning">A light accent gets dark text on buttons so it stays readable. Darker colours look stronger.</p> : null}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">Sidebar</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Object.entries(SIDEBAR_STYLES).map(([key, option]) => (
                <Choice key={key} active={theme.sidebar === key} onClick={() => set({ sidebar: key })}>
                  <span className="flex items-center gap-3">
                    <span className="h-10 w-6 shrink-0 rounded" style={{ background: `hsl(${themeTokens({ ...theme, sidebar: key }).light['--sidebar']})` }} aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium text-foreground">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </span>
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">Corners</legend>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {Object.entries(RADIUS_OPTIONS).map(([key, option]) => (
                <Choice key={key} active={theme.radius === key} onClick={() => set({ radius: key })}>
                  <span className="flex flex-col items-center gap-2 py-1">
                    <span className="h-7 w-12 border-2 border-primary bg-primary/10" style={{ borderRadius: option.value }} aria-hidden="true" />
                    <span className="text-sm font-medium text-foreground">{option.label}</span>
                  </span>
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">Font</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(FONT_OPTIONS).map(([key, option]) => (
                <Choice key={key} active={theme.font === key} onClick={() => set({ font: key })}>
                  <span className="block text-base text-foreground" style={{ fontFamily: option.stack }}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground" style={{ fontFamily: option.stack }}>
                    Loan approved: K25,000 over 12 months
                  </span>
                </Choice>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Emails fall back to a close system font where the mail app can’t load it; documents print in Helvetica, or Times for the serif font.</p>
          </fieldset>
        </div>

        <ThemePreview theme={theme} name={branding.name} logoSrc={branding.logoSrc} />
      </div>

      <FormError message={error} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => resetTo(DEFAULT_THEME)} disabled={busy || same(theme, DEFAULT_THEME)}>
          <RotateCcw />
          Default theme
        </Button>
        <div className="flex gap-2">
          {dirty ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetTo(saved)}
              disabled={busy}
            >
              Discard changes
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save theme
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-primary ring-1 ring-primary'
      )}
    >
      {children}
    </button>
  )
}

/** A small picture of the theme on the things people see most: a button, a badge, an email header. */
function ThemePreview({ theme, name, logoSrc }) {
  const onAccent = takesWhiteText(theme.colour) ? '#ffffff' : '#0f172a'
  return (
    <div className="space-y-4" aria-label="Preview">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
      <div className="rounded-lg border bg-card p-4 shadow-soft">
        <p className="text-sm font-semibold text-foreground">Application LOS-2026-000123</p>
        <p className="mt-1 text-xs text-muted-foreground">Personal loan · K25,000 · 12 months</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">In review</span>
          <a className="text-xs font-medium text-primary underline-offset-2 hover:underline" href="#preview" onClick={(event) => event.preventDefault()}>
            View documents
          </a>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm">Approve</Button>
          <Button size="sm" variant="outline">
            Request info
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border" style={{ fontFamily: FONT_OPTIONS[theme.font].email }}>
        <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: theme.colour, color: onAccent }}>
          <img src={logoSrc} alt="" className="size-7 object-contain" />
          <span className="truncate text-sm font-bold">{name}</span>
          <Mail className="ml-auto size-4 opacity-70" aria-hidden="true" />
        </div>
        <div className="space-y-2 bg-muted/40 px-4 py-3">
          <p className="text-xs font-semibold text-foreground">Your documents are ready to sign</p>
          <span className="inline-block px-3 py-1.5 text-xs font-semibold" style={{ background: theme.colour, color: onAccent, borderRadius: RADIUS_OPTIONS[theme.radius].email }}>
            Sign your documents →
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Emails and documents made after you save use the new theme; ones already sent keep theirs.</p>
    </div>
  )
}
