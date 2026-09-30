import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, History, Loader2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { api, toQuery } from '../api'
import { EmptyState, FormError, PageHeader, dateTime } from '../components'

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
}

const CATEGORIES = [
  { value: 'all', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins and passwords' },
  { value: 'user.', label: 'Team changes' },
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
  if (entry.action === 'user.updated' && detail.after) {
    const changes = Object.keys(detail.after).map((key) => (FIELD_LABELS[key] || key).toLowerCase())
    return `${base} (${changes.join(', ')})`
  }
  return base
}

export function AuditPage() {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [state, setState] = useState({ status: 'loading', entries: [], nextCursor: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const query = useCallback(
    (before) => api(`/audit${toQuery({ action: category, q: debouncedSearch, before })}`),
    [category, debouncedSearch]
  )

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, status: 'loading' }))
    query()
      .then((data) => !cancelled && setState({ status: 'ready', ...data }))
      .catch((error) => !cancelled && setState({ status: 'error', entries: [], nextCursor: null, message: error.message }))
    return () => {
      cancelled = true
    }
  }, [query])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const data = await query(state.nextCursor)
      setState((prev) => ({ ...prev, entries: [...prev.entries, ...data.entries], nextCursor: data.nextCursor }))
    } catch (error) {
      setState((prev) => ({ ...prev, message: error.message }))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every sign-in and change made in the workspace, newest first. Entries can’t be edited or removed."
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:w-80">
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
        <div className="sm:w-56">
          <Select aria-label="Filter by activity" value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 text-sm">
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {state.status === 'loading' ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading activity…
          </p>
        ) : state.status === 'error' ? (
          <div className="p-6">
            <FormError message={state.message} />
          </div>
        ) : state.entries.length === 0 ? (
          <EmptyState icon={History} title="No matching activity">
            Try another search or show all activity.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {state.entries.map((entry) => {
              const isOpen = expanded === entry.id
              const hasDetail = entry.detail && Object.keys(entry.detail).length > 0
              return (
                <li key={entry.id}>
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
              )
            })}
          </ul>
        )}
      </div>

      {state.nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="animate-spin" /> : null}
            Show older activity
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
