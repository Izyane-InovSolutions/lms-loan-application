import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ChevronDown, History, Loader2, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { api, toQuery } from '../api'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, dateTime, downloadCsv, useToast } from '../components'

// Plain-language names for recorded actions. Unknown ones fall back to the raw code,
// so a new action is still visible before it gets a label here.
const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.demo_login': 'Opened a demo session',
  'auth.customer_login': 'Customer signed in',
  'auth.invite_accepted': 'Accepted their invitation',
  'auth.password_reset': 'Reset their password',
  'auth.password_reset_requested': 'Asked for a password reset',
  'user.invited': 'Invited a team member',
  'user.updated': 'Changed a team member’s account',
  'user.invite_resent': 'Resent an invitation',
  'user.password_reset_sent': 'Sent a password reset link',
  'application.submitted': 'Application submitted',
  'application.viewed': 'Opened an application',
  'application.document_viewed': 'Viewed a document',
  'application.document_added': 'Added a document',
  'application.assign': 'Assigned a case',
  'application.start_review': 'Started a review',
  'application.request_info': 'Asked the applicant for information',
  'application.info_response': 'Applicant replied to a request',
  'application.check': 'Updated the verification checklist',
  'application.recommend': 'Recommended a decision',
  'application.decide': 'Made a credit decision',
  'application.note': 'Added a note',
  'application.mark_disbursed': 'Marked a loan as paid out',
  'application.prescreen_rerun': 'Re-ran the policy rules',
  'application.visit_logged': 'Logged a field visit',
  'application.crb_checked': 'Pulled a credit report',
  'application.lms_send': 'Sent a case to the LMS',
  'application.lms_reconciled': 'Reconciled an LMS hand-off',
  'rules.draft_saved': 'Saved a draft of the policy rules',
  'rules.draft_discarded': 'Discarded the policy rules draft',
  'rules.published': 'Published new policy rules',
  'settings.updated': 'Changed settings',
  'application.record_acceptance': 'Recorded a customer’s acceptance',
  'application.offer_accepted': 'Customer accepted an offer',
  'application.withdraw': 'Withdrew an application',
  'application.withdrawn': 'Customer withdrew an application',
  'auth.login_recovery_code': 'Signed in with a recovery code',
  'auth.two_factor_enabled': 'Turned on two-step sign-in',
  'auth.two_factor_disabled': 'Turned off two-step sign-in',
  'auth.sessions_revoked': 'Signed out other browsers',
  'legal.draft_saved': 'Saved a draft of the terms or privacy notice',
  'legal.draft_discarded': 'Discarded a terms or privacy draft',
  'legal.published': 'Published new terms or privacy notice',
  'privacy.searched': 'Looked up a person’s data',
  'privacy.exported': 'Exported a person’s data',
  'privacy.erased': 'Erased a person’s data',
  'retention.purged': 'Removed applications past their retention period',
  'settings.lms_tested': 'Tested the LMS connection',
  'settings.ai_tested': 'Tested an AI provider',
  'system.maintenance_run': 'Ran the daily maintenance',
  'demo.seeded': 'Added sample applications',
  'demo.cleared': 'Removed sample applications',
  'role.created': 'Added a role',
  'role.updated': 'Changed a role',
  'role.reset': 'Reset a role to its defaults',
  'role.deleted': 'Deleted a role',
}

const CATEGORIES = [
  { value: 'all', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins and passwords' },
  { value: 'user.', label: 'Team changes' },
  { value: 'role.', label: 'Roles and permissions' },
  { value: 'application.', label: 'Applications' },
  { value: 'rules.', label: 'Policy rules' },
  { value: 'settings.', label: 'Settings' },
  { value: 'privacy.', label: 'Data requests' },
]

const FIELD_LABELS = { role: 'Role', status: 'Status', managerId: 'Reports to', name: 'Name', phone: 'Phone', referralCode: 'Referral code' }

const formatValue = (key, value) => {
  if (value === null || value === undefined || value === '') return 'none'
  if (key === 'role') return roleLabel(value)
  if (key === 'managerId') return 'a relationship manager'
  return String(value)
}

/** One-line reading of an entry, used here and on the admin home page. */
export const describeAction = (entry) => {
  const base = ACTION_LABELS[entry.action] || entry.action
  const detail = entry.detail || {}
  if (entry.action === 'user.invited' && detail.email) return `${base}: ${detail.email} as ${roleLabel(detail.role).toLowerCase()}`
  if (entry.action.startsWith('application.') && detail.reference) return `${base}: ${detail.reference}`
  if (entry.action === 'rules.published' && detail.version) return `${base} (version ${detail.version})`
  if (entry.action.startsWith('role.') && (detail.after?.label || detail.label)) return `${base}: ${detail.after?.label || detail.label}`
  if (entry.action === 'user.updated' && detail.after) {
    const changes = Object.keys(detail.after).map((key) => (FIELD_LABELS[key] || key).toLowerCase())
    return `${base} (${changes.join(', ')})`
  }
  return base
}

const EXPORT_PAGE_LIMIT = 20 // 20 pages of 50 = 1,000 entries
const ALL = 'all'

const dayKey = (value) => new Date(value).toLocaleDateString('en-CA')
const dayLabel = (value) => {
  const key = dayKey(value)
  if (key === dayKey(Date.now())) return 'Today'
  if (key === dayKey(Date.now() - 86400000)) return 'Yesterday'
  return new Date(value).toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Local midnight / end of day as ISO, so the range matches the dates the person picked.
const startOfDay = (date) => (date ? new Date(`${date}T00:00:00`).toISOString() : '')
const endOfDay = (date) => (date ? new Date(`${date}T23:59:59.999`).toISOString() : '')

export function AuditPage() {
  const notify = useToast()
  const [params, setParams] = useSearchParams()
  const filters = {
    action: params.get('action') || ALL,
    q: params.get('q') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    actor: params.get('actor') || '',
    entity: params.get('entity') || '',
  }
  const [search, setSearch] = useState(filters.q)
  const [entityDraft, setEntityDraft] = useState(filters.entity)
  const [state, setState] = useState({ status: 'loading', entries: [], nextCursor: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [actions, setActions] = useState([])
  const [exporting, setExporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const setFilter = useCallback(
    (key, value) => {
      const next = new URLSearchParams(params)
      if (!value || value === ALL) next.delete(key)
      else next.set(key, value)
      setParams(next, { replace: true })
    },
    [params, setParams]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== filters.q) setFilter('q', search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Keep the entity box in step when the URL changes underneath it (a deep link, "clear").
  useEffect(() => setEntityDraft(filters.entity), [filters.entity])

  useEffect(() => {
    api('/audit/actions')
      .then((data) => setActions(data.actions || []))
      .catch(() => setActions([]))
  }, [])

  const fetchPage = useCallback(
    (before) =>
      api(
        `/audit${toQuery({
          action: filters.action,
          q: filters.q,
          actor: filters.actor,
          entity: filters.entity,
          from: startOfDay(filters.from),
          to: endOfDay(filters.to),
          before,
        })}`
      ),
    [filters.action, filters.q, filters.actor, filters.entity, filters.from, filters.to]
  )

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', entries: [], nextCursor: null })
    setMoreError('')
    fetchPage()
      .then((data) => !cancelled && setState({ status: 'ready', ...data }))
      .catch((error) => !cancelled && setState({ status: 'error', entries: [], nextCursor: null, message: error.message }))
    return () => {
      cancelled = true
    }
  }, [fetchPage, reloadKey])

  const loadMore = async () => {
    setLoadingMore(true)
    setMoreError('')
    try {
      const data = await fetchPage(state.nextCursor)
      setState((prev) => ({ ...prev, entries: [...prev.entries, ...data.entries], nextCursor: data.nextCursor }))
    } catch (error) {
      setMoreError(error.message || 'Couldn’t load older activity.')
    } finally {
      setLoadingMore(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = []
      let cursor
      let capped = false
      for (let page = 0; page < EXPORT_PAGE_LIMIT; page += 1) {
        const data = await fetchPage(cursor)
        rows.push(...data.entries)
        cursor = data.nextCursor
        if (!cursor) break
        if (page === EXPORT_PAGE_LIMIT - 1) capped = true
      }
      downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Time (UTC)', 'Person', 'Person id', 'Action', 'Description', 'Record type', 'Record id', 'IP address', 'Details'],
        ...rows.map((entry) => [
          entry.at,
          entry.actorLabel,
          entry.actorId || '',
          entry.action,
          describeAction(entry),
          entry.entityType || '',
          entry.entityId || '',
          entry.ip || '',
          entry.detail && Object.keys(entry.detail).length ? JSON.stringify(entry.detail) : '',
        ]),
      ])
      notify(capped ? `Exported the newest ${rows.length.toLocaleString()} entries. Narrow the dates to get older ones.` : `Exported ${rows.length.toLocaleString()} entries`)
    } catch (error) {
      notify(error.message || 'Couldn’t export the audit log')
    } finally {
      setExporting(false)
    }
  }

  const countFor = (prefix) => actions.filter((row) => row.action.startsWith(prefix)).reduce((sum, row) => sum + row.count, 0)
  const actorName = state.entries.find((entry) => entry.actorId === filters.actor)?.actorLabel
  const hasFilters = Boolean(filters.action !== ALL || filters.q || filters.from || filters.to || filters.actor || filters.entity)
  const clearAll = () => {
    setSearch('')
    setParams({}, { replace: true })
  }
  const showActions = actions.length ? actions : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every sign-in and change made in the workspace, newest first. Entries can’t be edited or removed."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting || state.status !== 'ready' || state.entries.length === 0}>
            {exporting ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
            Export CSV
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              placeholder="Search by person or record"
              aria-label="Search the audit log"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 pl-9 text-sm"
            />
          </div>
          <div className="lg:w-72">
            <Select aria-label="Filter by activity" value={filters.action} onChange={(event) => setFilter('action', event.target.value)} className="h-10 text-sm">
              <option value={ALL}>All activity</option>
              <optgroup label="Groups">
                {CATEGORIES.filter((option) => option.value !== ALL).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {actions.length ? ` (${countFor(option.value).toLocaleString()})` : ''}
                  </option>
                ))}
              </optgroup>
              {showActions.length ? (
                <optgroup label="Specific actions">
                  {showActions.map((row) => (
                    <option key={row.action} value={row.action}>
                      {ACTION_LABELS[row.action] || row.action} ({row.count.toLocaleString()})
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            From
            <Input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} className="h-10 w-40 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            To
            <Input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} className="h-10 w-40 text-sm" />
          </label>
        </div>

        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            setFilter('entity', entityDraft.trim())
          }}
        >
          <Input
            aria-label="Filter by record"
            placeholder="Record, e.g. application:ID or user"
            value={entityDraft}
            onChange={(event) => setEntityDraft(event.target.value)}
            onBlur={() => entityDraft.trim() !== filters.entity && setFilter('entity', entityDraft.trim())}
            className="h-10 text-sm sm:w-72"
          />
          {filters.actor ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-sm">
              Person: {actorName || `${filters.actor.slice(0, 8)}…`}
              <button type="button" aria-label="Remove the person filter" onClick={() => setFilter('actor', '')} className="rounded-full p-1 hover:bg-muted">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ) : null}
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {state.status === 'loading' ? (
          <SkeletonRows rows={8} className="p-4" />
        ) : state.status === 'error' ? (
          <ErrorState message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : state.entries.length === 0 ? (
          <EmptyState icon={History} title="No matching activity">
            Try another search or show all activity.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {state.entries.map((entry, index) => {
              const isOpen = expanded === entry.id
              const hasDetail = entry.detail && Object.keys(entry.detail).length > 0
              const newDay = index === 0 || dayKey(entry.at) !== dayKey(state.entries[index - 1].at)
              return (
                <React.Fragment key={entry.id}>
                  {newDay ? (
                    <li role="presentation" className="bg-muted/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {dayLabel(entry.at)}
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                      aria-expanded={isOpen}
                      disabled={!hasDetail && !entry.ip}
                      className="grid w-full grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 px-5 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent sm:grid-cols-[11rem_1fr_auto]"
                    >
                      <time dateTime={entry.at} className="col-span-2 text-xs tabular-nums text-muted-foreground sm:col-span-1 sm:pt-0.5">
                        {dateTime(entry.at)}
                      </time>
                      <span className="min-w-0">
                        <span className="block text-sm text-foreground">{describeAction(entry)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{entry.actorLabel}</span>
                      </span>
                      {hasDetail || entry.ip ? (
                        <ChevronDown className={cn('mt-1 size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                      ) : (
                        <span />
                      )}
                    </button>
                    {isOpen ? <EntryDetail entry={entry} /> : null}
                  </li>
                </React.Fragment>
              )
            })}
          </ul>
        )}
      </div>

      {moreError ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {moreError}
        </p>
      ) : null}
      {state.status === 'ready' && state.nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="animate-spin" /> : null}
            {moreError ? 'Try again' : 'Show older activity'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// Detail keys worth showing, in plain words. Ids and values already in the one-line
// description are left out rather than printed raw.
const DETAIL_LABELS = { email: 'Email', role: 'Role', emailed: 'Email sent' }

const detailValue = (key, value) => {
  if (key === 'role') return roleLabel(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No — link shared manually'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const ENTITY_LABELS = { user: 'account' }

function EntryDetail({ entry }) {
  const { before, after, ...rest } = entry.detail || {}
  const extra = Object.entries(rest).filter(([key, value]) => DETAIL_LABELS[key] && value !== null && value !== undefined)
  return (
    <div className="space-y-3 bg-muted/30 px-5 py-4 text-sm sm:pl-[12.25rem]">
      {after ? (
        <dl className="space-y-1">
          {Object.keys(after).map((key) => (
            <div key={key} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{FIELD_LABELS[key] || key}</dt>
              <dd className="text-foreground">
                {formatValue(key, before?.[key])} <span className="text-muted-foreground">to</span> {formatValue(key, after[key])}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {extra.length ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-1">
          {extra.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="text-muted-foreground">{DETAIL_LABELS[key]}</dt>
              <dd className="text-foreground">{detailValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {entry.entityType ? `${ENTITY_LABELS[entry.entityType] || entry.entityType} ${entry.entityId}` : null}
        {entry.ip ? `${entry.entityType ? ', ' : ''}from ${entry.ip}` : null}
      </p>
    </div>
  )
}
