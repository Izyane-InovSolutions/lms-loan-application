import React, { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Play, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '../api'
import { EmptyState, FormError, PageHeader, Panel, dateTime, timeAgo, useToast } from '../components'

const CHECKS = [
  ['database', 'Database', (check) => (check.kind === 'postgres' ? `Postgres${check.milliseconds !== undefined ? `, ${check.milliseconds} ms` : ''}` : 'Local database (development)')],
  ['redis', 'Drafts and codes store', (check) => check.kind],
  ['storage', 'Document storage', (check) => check.kind],
  ['email', 'Email', () => 'SMTP'],
  ['lms', 'Loan management system', (check) => (check.connected ? `Connected (${check.source})` : 'Not connected — running on its own')],
  ['ai', 'AI document checks', (check) => check.kind],
  ['crb', 'Credit bureau', (check) => (check.kind === 'demo' ? 'Sample data' : check.missing?.length ? `${check.kind}, missing ${check.missing.join(', ')}` : check.kind)],
  ['sms', 'Text messages', () => null],
  ['virusScan', 'Virus scanning', () => 'ClamAV'],
  ['secretsKey', 'Credentials encryption key', () => 'LOS_SECRETS_KEY'],
]

// Optional connections read as "off", not as failures.
const OPTIONAL = ['lms', 'ai', 'crb', 'sms', 'virusScan']

export function HealthPage() {
  const notify = useToast()
  const [state, setState] = useState({ status: 'loading' })
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', ...(await api(`/admin/health${showResolved ? '?resolved=1' : ''}`)) })
    } catch (error) {
      setState({ status: 'error', message: error.message })
    }
  }, [showResolved])

  useEffect(() => {
    load()
  }, [load])

  const resolve = async (id) => {
    await api(`/admin/health/errors/${id}/resolve`, { method: 'POST' })
    notify('Marked as resolved')
    load()
  }

  const runMaintenance = async () => {
    setRunning(true)
    try {
      await api('/admin/health/run-maintenance', { method: 'POST' })
      notify('Daily maintenance finished')
      load()
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setRunning(false)
    }
  }

  if (state.status === 'loading') return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
  if (state.status === 'error') return <FormError message={state.message} />

  return (
    <div className="space-y-6">
      <PageHeader title="System health" description="Connections, the daily maintenance run, and errors from the server and from people’s browsers." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <Panel title="Connections">
            <ul className="space-y-3">
              {CHECKS.map(([key, label, describe]) => {
                const check = state.checks[key] || {}
                const ok = key === 'lms' ? check.connected : check.ok
                const optional = OPTIONAL.includes(key)
                return (
                  <li key={key} className="flex items-start gap-3 text-sm">
                    {ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Working" />
                    ) : (
                      <X className={cn('mt-0.5 size-4 shrink-0', optional ? 'text-muted-foreground' : 'text-destructive')} aria-label={optional ? 'Off' : 'Problem'} />
                    )}
                    <span>
                      <span className="block text-foreground">{label}</span>
                      <span className="block text-xs text-muted-foreground">{ok ? describe(check) || 'On' : optional ? 'Off' : check.message || 'Not configured'}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </Panel>
          <Panel
            title="Daily maintenance"
            action={
              <Button variant="outline" size="sm" onClick={runMaintenance} disabled={running}>
                {running ? <Loader2 className="animate-spin" /> : <Play />}
                Run now
              </Button>
            }
          >
            {state.cron ? (
              <div className="space-y-2 text-sm">
                <p className="text-foreground">Last ran {timeAgo(state.cron.at)}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <dt>Offers expired</dt>
                  <dd className="text-foreground">{state.cron.offersExpired ?? '—'}</dd>
                  <dt>Overdue cases flagged</dt>
                  <dd className="text-foreground">{state.cron.overdue ?? '—'}</dd>
                  <dt>Removed by retention</dt>
                  <dd className="text-foreground">{state.cron.retention ? Object.values(state.cron.retention).reduce((sum, value) => sum + value, 0) : '—'}</dd>
                  <dt>LMS retries</dt>
                  <dd className="text-foreground">{state.cron.lms?.attempted ?? '—'}</dd>
                  <dt>Payouts picked up from the LMS</dt>
                  <dd className="text-foreground">{state.cron.lms?.disbursed ?? '—'}</dd>
                  <dt>Old draft files removed</dt>
                  <dd className="text-foreground">{state.cron.deleted ?? '—'}</dd>
                </dl>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Hasn’t run yet. On Vercel it runs every morning; locally, use Run now.</p>
            )}
          </Panel>
        </div>

        <Panel
          title={`Errors${state.openErrors ? ` (${state.openErrors} open)` : ''}`}
          action={
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} className="accent-[hsl(var(--primary))]" />
              Show resolved
            </label>
          }
          bodyClassName="p-0"
        >
          {state.errors.length === 0 ? (
            <EmptyState icon={Check} title="No errors">
              Server and browser errors appear here, grouped, as they happen.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {state.errors.map((entry) => (
                <li key={entry.id}>
                  <div className="flex items-start gap-3 px-5 py-3">
                    <button type="button" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)} className="min-w-0 flex-1 text-left" aria-expanded={expanded === entry.id}>
                      <span className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{entry.source}</span>
                        <span className="truncate text-sm text-foreground">{entry.message}</span>
                        <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', expanded === entry.id && 'rotate-180')} aria-hidden="true" />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {entry.count} {entry.count === 1 ? 'time' : 'times'}, last {timeAgo(entry.lastSeenAt)}
                        {entry.route ? `, ${entry.route}` : ''}
                        {entry.resolvedAt ? ', resolved' : ''}
                      </span>
                    </button>
                    {!entry.resolvedAt ? (
                      <Button variant="ghost" size="sm" onClick={() => resolve(entry.id)}>
                        Resolve
                      </Button>
                    ) : null}
                  </div>
                  {expanded === entry.id ? (
                    <div className="bg-muted/30 px-5 py-3">
                      <p className="text-xs text-muted-foreground">First seen {dateTime(entry.firstSeenAt)}</p>
                      {entry.stack ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{entry.stack}</pre> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
