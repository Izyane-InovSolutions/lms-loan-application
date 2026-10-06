import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { roleLabel, USER_STATUSES } from '@/config/roles'

/**
 * Keeps one failing page from blanking the whole workspace: the sidebar stays usable and
 * the page offers a reload. Reset by changing `resetKey` (the route).
 */
export class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  componentDidCatch(error) {
    console.error(`[admin] page crashed: ${error?.message || error}`)
    import('@/lib/reportErrors').then(({ reportError }) => reportError(error)).catch(() => {})
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="rounded-xl border bg-card p-8">
        <p className="font-medium text-foreground">This page ran into a problem and couldn’t be shown.</p>
        <p className="mt-1 text-sm text-muted-foreground">Reload to try again. If it keeps happening, tell your administrator what you were doing.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md border px-3 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reload page
        </button>
      </div>
    )
  }
}

/** Page title, a one-line purpose, and the page's primary action on the right. */
export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

// Each role keeps one hue everywhere it appears (badges, charts, the team bar), so
// people learn to read the colour before the label.
export const ROLE_TONES = {
  admin: { dot: 'bg-[hsl(204_62%_28%)]', chip: 'bg-[hsl(204_62%_28%/0.1)] text-[hsl(204_62%_28%)] dark:text-[hsl(205_80%_72%)]', bar: 'hsl(204 62% 28%)' },
  loan_officer: { dot: 'bg-[hsl(174_58%_32%)]', chip: 'bg-[hsl(174_58%_32%/0.12)] text-[hsl(174_58%_28%)] dark:text-[hsl(174_50%_62%)]', bar: 'hsl(174 58% 32%)' },
  sales_manager: { dot: 'bg-[hsl(262_40%_48%)]', chip: 'bg-[hsl(262_40%_48%/0.12)] text-[hsl(262_40%_42%)] dark:text-[hsl(262_60%_76%)]', bar: 'hsl(262 40% 48%)' },
  rm: { dot: 'bg-[hsl(32_85%_42%)]', chip: 'bg-[hsl(32_85%_42%/0.12)] text-[hsl(32_85%_34%)] dark:text-[hsl(36_85%_64%)]', bar: 'hsl(32 85% 42%)' },
  dsa: { dot: 'bg-[hsl(205_70%_52%)]', chip: 'bg-[hsl(205_70%_52%/0.12)] text-[hsl(205_70%_38%)] dark:text-[hsl(205_80%_72%)]', bar: 'hsl(205 70% 52%)' },
  customer: { dot: 'bg-muted-foreground', chip: 'bg-muted text-muted-foreground', bar: 'hsl(215 16% 60%)' },
}

// Roles an admin added share one hue; their label tells them apart.
const CUSTOM_ROLE_TONE = { dot: 'bg-[hsl(340_45%_48%)]', chip: 'bg-[hsl(340_45%_48%/0.12)] text-[hsl(340_45%_40%)] dark:text-[hsl(340_60%_76%)]', bar: 'hsl(340 45% 48%)' }

export const roleTone = (role) => ROLE_TONES[role] || CUSTOM_ROLE_TONE

export function RoleBadge({ role, className }) {
  const tone = roleTone(role)
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', tone.chip, className)}>
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      {roleLabel(role)}
    </span>
  )
}

const STATUS_STYLES = {
  active: 'text-success',
  invited: 'text-warning',
  disabled: 'text-muted-foreground line-through decoration-muted-foreground/50',
}

export function StatusText({ status }) {
  return <span className={cn('text-sm font-medium', STATUS_STYLES[status])}>{USER_STATUSES[status] || status}</span>
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {Icon ? <Icon className="mb-1 size-8 text-muted-foreground/60" aria-hidden="true" /> : null}
      <p className="font-medium text-foreground">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/** A failed load, with the reason and a way to try again. */
export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <AlertCircle className="mb-1 size-8 text-destructive/70" aria-hidden="true" />
      <p className="font-medium text-foreground">Couldn’t load this</p>
      {message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          Try again
        </button>
      ) : null}
    </div>
  )
}

/** Placeholder rows while a list loads. */
export function SkeletonRows({ rows = 5, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  )
}

export function Initials({ name, className }) {
  const letters = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', className)}
    >
      {letters}
    </span>
  )
}

/** A labelled control with its error, wired for screen readers. */
export function Field({ id, label, hint, error, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function FormError({ message }) {
  if (!message) return null
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 hours ago", "yesterday", "just now". */
export const timeAgo = (value) => {
  if (!value) return 'Never'
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormatter.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

// ---------------------------------------------------------------------------
// Toasts: short confirmations named after the action ("Invitation sent").
// ---------------------------------------------------------------------------

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  const notify = useCallback(
    (message, { tone = 'success' } = {}) => {
      idRef.current += 1
      const id = idRef.current
      setToasts((current) => [...current.slice(-2), { id, message, tone }])
      setTimeout(() => dismiss(id), 5000)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDismiss }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const Icon = toast.tone === 'error' ? AlertCircle : CheckCircle2
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-lift transition-all duration-200 motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', toast.tone === 'error' ? 'text-destructive' : 'text-success')} aria-hidden="true" />
      <p className="flex-1">{toast.message}</p>
      <button type="button" onClick={onDismiss} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}

export const useToast = () => useContext(ToastContext)

// ---------------------------------------------------------------------------
// Application display helpers
// ---------------------------------------------------------------------------

const STATUS_TONES = {
  submitted: 'bg-secondary text-secondary-foreground',
  in_review: 'bg-accent text-accent-foreground',
  info_requested: 'bg-warning/15 text-warning',
  pending_approval: 'bg-[hsl(262_40%_48%/0.12)] text-[hsl(262_40%_42%)] dark:text-[hsl(262_60%_76%)]',
  approved: 'bg-success/15 text-success',
  accepted: 'bg-success/15 text-success',
  disbursed: 'bg-success/15 text-success',
  declined: 'bg-muted text-muted-foreground',
  withdrawn: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status, label }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', STATUS_TONES[status] || STATUS_TONES.submitted)}>
      {label}
    </span>
  )
}

const OUTCOME_STYLES = {
  pass: { label: 'Rules passed', className: 'text-success', dot: 'bg-success' },
  refer: { label: 'Refer', className: 'text-warning', dot: 'bg-warning' },
  decline: { label: 'Decline advised', className: 'text-destructive', dot: 'bg-destructive' },
}

/** The credit rules' verdict, as a dot and a word. */
export function OutcomeMark({ outcome, className }) {
  const style = OUTCOME_STYLES[outcome]
  if (!style) return <span className={cn('text-xs text-muted-foreground', className)}>Pending</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', style.className, className)}>
      <span className={cn('size-1.5 rounded-full', style.dot)} aria-hidden="true" />
      {style.label}
    </span>
  )
}

export const money = (value) =>
  value === null || value === undefined ? '—' : `K${Number(value).toLocaleString('en-ZM', { maximumFractionDigits: 0 })}`

/** Whole days since a date, for ageing badges. */
export const daysSince = (value) => Math.floor((Date.now() - new Date(value).getTime()) / 86400000)

/** A CSV cell, with spreadsheet formulas neutralised so an applicant's name cannot run in Excel. */
const csvCell = (value) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`

export const downloadCsv = (filename, rows) => {
  const blob = new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A titled surface for grouping related content on a page. */
export function Panel({ title, description, action, children, className, bodyClassName }) {
  return (
    <section className={cn('rounded-xl border bg-card', className)}>
      {title ? (
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
