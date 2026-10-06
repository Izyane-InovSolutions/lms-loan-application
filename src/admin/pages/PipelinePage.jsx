import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownToLine, ChevronDown, ChevronRight, Clock, FileStack, FilePen, Info, MessageCircleQuestion, Search, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { APPLICATION_STATUSES, LOAN_TYPE_LABELS, statusLabel } from '@/config/applications'
import { hasPermission } from '@/config/roles'
import { api } from '../api'
import { useAuth } from '../auth'
import { EmptyState, ErrorState, OutcomeMark, PageHeader, SkeletonRows, daysSince, downloadCsv, money, timeAgo } from '../components'
import { DraftDialog } from '../DraftDialog'

// Unfinished applications come first: the stage before "submitted".
const DRAFT_COLUMN = { key: 'draft', label: 'Draft', accent: 'bg-muted-foreground/30' }

// Column colours by where a state sits in the journey (its reporting category).
const ACCENTS = {
  submitted: 'bg-muted-foreground/60',
  in_review: 'bg-primary',
  info_requested: 'bg-warning',
  pending_approval: 'bg-[hsl(262_40%_48%)]',
  approved: 'bg-success',
  accepted: 'bg-success',
  disbursed: 'bg-success',
  declined: 'bg-muted-foreground/40',
  withdrawn: 'bg-muted-foreground/30',
  expired: 'bg-muted-foreground/30',
}

// Where a case's journey has ended. Folded into one summary column unless asked for.
const END_KEYS = ['paid_out', 'declined', 'closed']

/**
 * The board's columns from the workflow (Workflow editor): one per state in the order a
 * case moves, with "Waiting on applicant" after the review states, then the ends. Cases on
 * an older version, in a state the current one no longer has, get a column of their own.
 */
const workflowColumns = (workflow, applications) => {
  const current = workflow.current
  const byId = Object.fromEntries(current.states.map((state) => [state.id, state]))
  const work = current.order.filter((id) => byId[id] && byId[id].type !== 'final')
  // A state turned off gets no new cases; its column shows only while older cases are in it.
  const columns = work.map((id) => ({ key: id, label: byId[id].label, accent: ACCENTS[current.categories[id]], hideEmpty: Boolean(byId[id].disabled), match: (row) => row.state === id && row.status !== 'info_requested' }))
  const afterReview = columns.findIndex((column) => !['submitted', 'in_review'].includes(current.categories[column.key]))
  columns.splice(afterReview === -1 ? columns.length : afterReview, 0, { key: 'info_requested', label: 'Waiting on applicant', accent: ACCENTS.info_requested, match: (row) => row.status === 'info_requested' })

  const known = new Set(current.states.map((state) => state.id))
  const retired = new Map()
  for (const version of workflow.versions) {
    for (const state of version.states) {
      if (!known.has(state.id) && state.type !== 'final' && !retired.has(state.id)) retired.set(state.id, { key: `retired:${state.id}`, label: `${state.label} (earlier workflow)`, accent: ACCENTS[version.categories[state.id]], match: (row) => row.state === state.id && row.status !== 'info_requested' })
    }
  }
  const name = (id, fallback) => byId[id]?.label || fallback
  return [
    ...columns,
    ...retired.values(),
    { key: 'paid_out', label: name('paid_out', 'Paid out'), accent: ACCENTS.disbursed, match: (row) => row.status === 'disbursed' },
    { key: 'declined', label: name('declined', 'Declined'), accent: ACCENTS.declined, match: (row) => row.status === 'declined' },
    { key: 'closed', label: 'Withdrawn or lapsed', accent: ACCENTS.withdrawn, match: (row) => ['withdrawn', 'expired'].includes(row.status) },
  ]
    .map((column) => ({ ...column, cards: applications.filter(column.match) }))
    .filter((column) => !column.hideEmpty || column.cards.length)
}

// The board loads this many applications; past it the columns are partial.
const PAGE_SIZE = 200

// Used until the server says otherwise (Settings → Workflow).
const DEFAULT_SLA_DAYS = 3

// The status the applications list filters by for a column, for its "view all" link.
const COLUMN_STATUS = { info_requested: 'info_requested', paid_out: 'disbursed', declined: 'declined', closed: 'withdrawn' }

// By what the viewer's role lets them see.
const DESCRIPTIONS = {
  own: 'Every customer you’ve brought in, by stage.',
  team: 'Your customers and your agents’ customers, by stage.',
  all: 'The whole pipeline, by stage.',
}

const NO_FILTERS = { q: '', officer: 'all', loanType: 'all', mine: false, overdue: false }

// Card order within a column. "Waiting longest" puts the case that needs a push first.
const SORTS = {
  waiting: { label: 'Waiting longest', compare: (a, b) => sinceOf(a) - sinceOf(b) },
  newest: { label: 'Newest', compare: (a, b) => sinceOf(b) - sinceOf(a) },
  largest: { label: 'Largest', compare: (a, b) => (b.amount || 0) - (a.amount || 0) },
}

// When a card arrived where it is: its stage for a case, its last save for a draft.
const sinceOf = (row) => new Date(row.lastSavedAt || row.stateEnteredAt || row.submittedAt || 0).getTime()

const initialsOf = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

/** How far a case is through its target time: nothing, getting close, or past it. */
const ageing = (row, slaDays) => {
  if (!APPLICATION_STATUSES[row.status]?.open) return null
  const age = daysSince(row.submittedAt)
  if (age >= slaDays) return { tone: 'overdue', age }
  if (age >= Math.max(1, Math.ceil(slaDays / 2))) return { tone: 'warn', age }
  return { tone: 'ok', age }
}

const AGEING_STYLES = {
  overdue: { edge: 'border-l-destructive', badge: 'bg-destructive/10 text-destructive' },
  warn: { edge: 'border-l-warning', badge: 'bg-warning/15 text-warning' },
  ok: { edge: 'border-l-transparent', badge: 'text-muted-foreground' },
}

// Board layout (collapsed columns, card order, ended stages) is kept per person in this browser.
const prefsKey = (userId) => `los:pipeline:${userId}`
const readPrefs = (userId) => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(prefsKey(userId)) || 'null')
    return { collapsed: Array.isArray(saved?.collapsed) ? saved.collapsed : [], sorts: saved?.sorts || {}, showEnded: Boolean(saved?.showEnded) }
  } catch {
    return { collapsed: [], sorts: {}, showEnded: false }
  }
}

/**
 * A board of the pipeline by stage, starting with drafts (for roles with drafts.view).
 * Read-only: cases move from the case page, drafts from their own window.
 */
export function PipelinePage() {
  const { user, workflow } = useAuth()
  const [state, setState] = useState({ status: 'loading' })
  const [openDraft, setOpenDraft] = useState(null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [prefs, setPrefs] = useState(() => readPrefs(user.id))
  const showDrafts = hasPermission(user, 'drafts.view')
  const slaDays = Number(state.slaDays) || DEFAULT_SLA_DAYS

  const load = useCallback(() => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, refreshing: true } : { status: 'loading' }))
    Promise.all([api(`/applications?status=&pageSize=${PAGE_SIZE}&sort=updated`), showDrafts ? api('/drafts') : Promise.resolve({ drafts: [] })])
      .then(([data, { drafts }]) => setState({ status: 'ready', ...data, drafts }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [showDrafts])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    try {
      window.localStorage.setItem(prefsKey(user.id), JSON.stringify(prefs))
    } catch {
      // Storage blocked: the layout resets on the next visit.
    }
  }, [prefs, user.id])

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }))
  const toggleColumn = (key) => setPrefs((prev) => ({ ...prev, collapsed: prev.collapsed.includes(key) ? prev.collapsed.filter((entry) => entry !== key) : [...prev.collapsed, key] }))
  const setSort = (key, sort) => setPrefs((prev) => ({ ...prev, sorts: { ...prev.sorts, [key]: sort } }))
  const setShowEnded = (showEnded) => setPrefs((prev) => ({ ...prev, showEnded }))

  /** Brings a column into view, opening it first when collapsed. */
  const jumpTo = (key) => {
    setPrefs((prev) => ({ ...prev, collapsed: prev.collapsed.filter((entry) => entry !== key), showEnded: prev.showEnded || END_KEYS.includes(key) }))
    requestAnimationFrame(() => document.getElementById(`col-${key}`)?.closest('section')?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }))
  }

  // Officers on the loaded cards, for the filter.
  const officers = useMemo(() => {
    if (state.status !== 'ready') return []
    const byId = new Map()
    for (const row of state.applications) if (row.assignedOfficer && row.assignedOfficerName) byId.set(row.assignedOfficer, row.assignedOfficerName)
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]))
  }, [state])

  const hasFilters = Boolean(filters.q.trim()) || filters.officer !== 'all' || filters.loanType !== 'all' || filters.mine || filters.overdue

  // Every column with the search and filters applied, before "overdue only" and sorting.
  const board = useMemo(() => {
    if (state.status !== 'ready' || !workflow) return []
    const needle = filters.q.trim().toLowerCase()
    const mine = (row) => row.sourcedBy === user.id || row.assignedOfficer === user.id
    const matches = (row, fields) =>
      (filters.loanType === 'all' || row.loanType === filters.loanType) &&
      (!filters.mine || mine(row)) &&
      (!needle || fields.some((field) => String(field || '').toLowerCase().includes(needle)))
    const columns = workflowColumns(
      workflow,
      state.applications.filter(
        (row) =>
          matches(row, [row.companyName, row.applicantName, row.reference]) &&
          (filters.officer === 'all' || (filters.officer === 'unassigned' ? !row.assignedOfficer : row.assignedOfficer === filters.officer))
      )
    )
    if (!showDrafts) return columns
    // Drafts have no officer, so an officer filter leaves them out.
    const drafts = filters.officer === 'all' ? state.drafts.filter((row) => matches(row, [row.companyName, row.applicantName, row.email])) : []
    return [{ ...DRAFT_COLUMN, cards: drafts }, ...columns]
  }, [state, showDrafts, workflow, filters.q, filters.officer, filters.loanType, filters.mine, user.id])

  // The headline figures, over what the filters leave (but not "overdue only", which they drive).
  const summary = useMemo(() => {
    const work = board.filter((column) => column.key !== 'draft' && !END_KEYS.includes(column.key)).flatMap((column) => column.cards)
    const open = work.filter((row) => APPLICATION_STATUSES[row.status]?.open)
    const paidOut = board.find((column) => column.key === 'paid_out')?.cards || []
    const sum = (rows) => rows.reduce((total, row) => total + (row.amount || 0), 0)
    return {
      open: open.length,
      openValue: sum(open),
      overdue: open.filter((row) => daysSince(row.submittedAt) >= slaDays).length,
      averageDays: open.length ? Math.round(open.reduce((total, row) => total + daysSince(row.submittedAt), 0) / open.length) : 0,
      waiting: board.find((column) => column.key === 'info_requested')?.cards.length || 0,
      drafts: board.find((column) => column.key === 'draft')?.cards.length || 0,
      paidOut: paidOut.length,
      paidOutValue: sum(paidOut),
    }
  }, [board, slaDays])

  // What the board shows: "overdue only" applied, cards sorted, value totals worked out.
  const columns = useMemo(() => {
    const overdueOnly = (row) => !filters.overdue || ageing(row, slaDays)?.tone === 'overdue'
    return board.map((column) => {
      const sort = SORTS[prefs.sorts[column.key]] ? prefs.sorts[column.key] : 'waiting'
      const cards = (filters.overdue && column.key === 'draft' ? [] : column.cards.filter(overdueOnly)).slice().sort(SORTS[sort].compare)
      return { ...column, cards, sort, value: cards.reduce((sum, row) => sum + (row.amount || 0), 0) }
    })
  }, [board, filters.overdue, prefs.sorts, slaDays])

  const working = columns.filter((column) => !END_KEYS.includes(column.key))
  const ended = columns.filter((column) => END_KEYS.includes(column.key))
  const shown = columns.reduce((sum, column) => sum + column.cards.length, 0)
  const largestValue = Math.max(1, ...working.map((column) => column.value))
  const capped = state.status === 'ready' && (state.total > state.applications.length || state.applications.length >= PAGE_SIZE)

  const exportCsv = () => {
    downloadCsv(`pipeline-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Stage', 'Reference', 'Applicant', 'Company', 'Product', 'Amount (ZMW)', 'Status', 'Rules', 'Brought in by', 'Officer', 'Submitted', 'Days in stage'],
      ...columns.flatMap((column) =>
        column.cards.map((row) => [
          column.label,
          row.reference || '',
          row.applicantName || row.email || '',
          row.companyName || '',
          LOAN_TYPE_LABELS[row.loanType],
          row.amount ?? '',
          column.key === 'draft' ? 'Draft' : statusLabel(row.status),
          row.prescreenOutcome || '',
          row.sourcedByName || '',
          row.assignedOfficerName || '',
          row.submittedAt ? new Date(row.submittedAt).toISOString() : '',
          column.key === 'draft' ? '' : daysSince(row.stateEnteredAt || row.submittedAt),
        ])
      ),
    ])
  }

  const renderColumn = (column) => (
    <BoardColumn
      key={column.key}
      column={column}
      collapsed={prefs.collapsed.includes(column.key)}
      onToggle={() => toggleColumn(column.key)}
      onSort={(sort) => setSort(column.key, sort)}
      valueShare={END_KEYS.includes(column.key) ? null : column.value / largestValue}
      slaDays={slaDays}
      viewerId={user.id}
      onOpenDraft={setOpenDraft}
    />
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description={DESCRIPTIONS[user.scope]}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={state.status !== 'ready' || !shown}>
            <ArrowDownToLine />
            Export CSV
          </Button>
        }
      />

      {state.status === 'ready' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <SummaryTile icon={FileStack} label="Open cases" value={summary.open} detail={`${money(summary.openValue)} requested`} />
          <SummaryTile
            icon={AlertTriangle}
            label={`Past ${slaDays}-day target`}
            value={summary.overdue}
            detail={filters.overdue ? 'Showing only these' : summary.overdue ? 'Show only these' : 'All within target'}
            tone={summary.overdue ? 'alert' : undefined}
            pressed={filters.overdue}
            onClick={summary.overdue || filters.overdue ? () => setFilter('overdue', !filters.overdue) : undefined}
          />
          <SummaryTile icon={Clock} label="Average days open" value={summary.averageDays} detail="Open cases, since submitted" />
          <SummaryTile icon={MessageCircleQuestion} label="Waiting on applicant" value={summary.waiting} detail="Go to the column" onClick={() => jumpTo('info_requested')} />
          {showDrafts ? (
            <SummaryTile icon={FilePen} label="Drafts in progress" value={summary.drafts} detail="Go to the column" onClick={() => jumpTo('draft')} />
          ) : (
            <SummaryTile icon={Wallet} label="Paid out" value={summary.paidOut} detail={money(summary.paidOutValue)} onClick={() => jumpTo('paid_out')} />
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search name or reference"
            aria-label="Search the pipeline by name or reference"
            value={filters.q}
            onChange={(event) => setFilter('q', event.target.value)}
            className="h-10 pl-9 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <div className="sm:w-44">
            <Select aria-label="Officer" value={filters.officer} onChange={(event) => setFilter('officer', event.target.value)} className="h-10 text-sm">
              <option value="all">Any officer</option>
              <option value="unassigned">Unassigned</option>
              {officers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-40">
            <Select aria-label="Product" value={filters.loanType} onChange={(event) => setFilter('loanType', event.target.value)} className="h-10 text-sm">
              <option value="all">All products</option>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </Select>
          </div>
          <Button variant={filters.mine ? 'default' : 'outline'} aria-pressed={filters.mine} onClick={() => setFilter('mine', !filters.mine)} className="h-10">
            Mine
          </Button>
          <Button variant={prefs.showEnded ? 'default' : 'outline'} aria-pressed={prefs.showEnded} onClick={() => setShowEnded(!prefs.showEnded)} className="h-10">
            Ended stages
          </Button>
          {hasFilters ? (
            <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)} className="h-10">
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground lg:ml-auto" aria-live="polite">
          {state.status === 'ready' ? `${shown} ${shown === 1 ? 'card' : 'cards'}${state.refreshing ? ', refreshing…' : ''}` : null}
        </p>
      </div>

      {capped ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Showing the {PAGE_SIZE} most recently updated applications{state.total ? ` of ${state.total}` : ''}. Older ones are left off the board; use “View all” on a column to see every one.
          </span>
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <div className="flex gap-4 overflow-hidden" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonRows key={index} rows={4} className="w-72 shrink-0 rounded-xl bg-muted/50 p-3" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className="rounded-xl border bg-card">
          <ErrorState message={state.message} onRetry={load} />
        </div>
      ) : shown === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={FileStack}
            title={hasFilters ? 'Nothing matches these filters' : 'The pipeline is empty'}
            action={
              hasFilters ? (
                <Button size="sm" variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              ) : null
            }
          >
            {hasFilters ? 'Try a different search or clear the filters to see the whole board.' : 'New submissions appear here as soon as they arrive.'}
          </EmptyState>
        </div>
      ) : (
        <div role="region" aria-label="Pipeline board" tabIndex={0} className="-mx-4 snap-x snap-mandatory overflow-x-auto scroll-px-4 px-4 pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-10 lg:scroll-px-10 lg:px-10">
          <div className="flex min-w-max items-start gap-4">
            {working.map(renderColumn)}
            {prefs.showEnded ? ended.map(renderColumn) : <EndedSummary columns={ended} onShow={() => setShowEnded(true)} />}
          </div>
        </div>
      )}
      <DraftDialog draftId={openDraft} onOpenChange={(open) => !open && setOpenDraft(null)} onChanged={load} />
    </div>
  )
}

/** A headline figure. Clickable ones filter the board or bring a column into view. */
function SummaryTile({ icon: Icon, label, value, detail, tone, pressed, onClick }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={cn('size-3.5', tone === 'alert' && 'text-destructive')} aria-hidden="true" />
        {label}
      </span>
      <span className={cn('mt-1 block text-2xl font-semibold tabular-nums tracking-tight text-foreground', tone === 'alert' && 'text-destructive')}>{value}</span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
    </>
  )
  const className = cn('rounded-xl border bg-card px-4 py-3 text-left shadow-sm', pressed && 'border-destructive/50 ring-1 ring-destructive/30')
  if (!onClick) return <div className={className}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(className, 'transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      {body}
    </button>
  )
}

/** One stage: header with count, value and order, then its cards. */
function BoardColumn({ column, collapsed, onToggle, onSort, valueShare, slaDays, viewerId, onOpenDraft }) {
  const id = `col-${column.key}`
  const status = column.key === 'draft' ? null : COLUMN_STATUS[column.key] || column.cards[0]?.status || (column.key.startsWith('retired:') ? null : column.key)
  return (
    <section aria-labelledby={id} className={cn('flex shrink-0 snap-start flex-col rounded-xl bg-muted/50 dark:bg-card/40', collapsed ? 'w-14 self-stretch' : 'w-[85vw] sm:w-72')}>
      <header className={cn('sticky top-0 z-10 rounded-t-xl px-3 pb-2 pt-3', collapsed && 'px-2')}>
        <div className={cn('flex items-center gap-2', collapsed && 'flex-col')}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={`${id}-cards`}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${column.label}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {collapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          </button>
          <span className={cn('size-2 shrink-0 rounded-full', column.accent)} aria-hidden="true" />
          <h2 id={id} className={cn('truncate text-sm font-semibold text-foreground', collapsed && 'whitespace-nowrap [writing-mode:vertical-rl]')}>
            {column.label}
          </h2>
          <span className={cn('rounded-full bg-background px-1.5 text-xs font-medium tabular-nums text-muted-foreground', !collapsed && 'ml-auto')}>{column.cards.length}</span>
        </div>
        {collapsed ? null : (
          <>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium tabular-nums text-foreground/80">{money(column.value)}</p>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`${id}-sort`}>
                  Order {column.label} by
                </label>
                <select
                  id={`${id}-sort`}
                  value={column.sort}
                  onChange={(event) => onSort(event.target.value)}
                  className="h-6 cursor-pointer rounded border-0 bg-transparent pr-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Object.entries(SORTS).map(([key, sort]) => (
                    <option key={key} value={key}>
                      {sort.label}
                    </option>
                  ))}
                </select>
                {status ? (
                  <Link to={`/admin/applications?status=${status}`} className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    View all<span className="sr-only"> {column.label} applications</span>
                  </Link>
                ) : null}
              </div>
            </div>
            {valueShare !== null ? (
              <div className="mt-2 h-1 rounded-full bg-background" aria-hidden="true">
                <div className={cn('h-full rounded-full opacity-70', column.accent)} style={{ width: `${Math.max(column.value ? 4 : 0, valueShare * 100)}%` }} />
              </div>
            ) : null}
          </>
        )}
      </header>
      <ol id={`${id}-cards`} hidden={collapsed} className="flex max-h-[calc(100vh-24rem)] min-h-[12rem] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {column.cards.length === 0 ? <li className="rounded-lg border border-dashed px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</li> : null}
        {column.cards.map((row) => (
          <li key={row.id}>{column.key === 'draft' ? <DraftCard row={row} viewerId={viewerId} onOpen={() => onOpenDraft(row.id)} /> : <CaseCard row={row} slaDays={slaDays} viewerId={viewerId} />}</li>
        ))}
      </ol>
    </section>
  )
}

/** The ended stages folded into one column: counts and value, and a way to open them. */
function EndedSummary({ columns, onShow }) {
  return (
    <section aria-labelledby="col-ended" className="w-[85vw] shrink-0 snap-start rounded-xl border border-dashed p-3 sm:w-60">
      <h2 id="col-ended" className="text-sm font-semibold text-foreground">
        Ended
      </h2>
      <ul className="mt-2 space-y-1.5">
        {columns.map((column) => (
          <li key={column.key} className="flex items-center gap-2 text-xs">
            <span className={cn('size-2 shrink-0 rounded-full', column.accent)} aria-hidden="true" />
            <span className="truncate text-muted-foreground">{column.label}</span>
            <span className="ml-auto tabular-nums text-foreground">{column.cards.length}</span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={onShow} className="mt-3 w-full">
        Show ended stages
      </Button>
    </section>
  )
}

/** A case on the board: who, how much, how long, who has it. Opens the case. */
function CaseCard({ row, slaDays, viewerId }) {
  const age = ageing(row, slaDays)
  const style = AGEING_STYLES[age?.tone] || AGEING_STYLES.ok
  const inStage = daysSince(row.stateEnteredAt || row.submittedAt)
  return (
    <Link
      to={`/admin/applications/${row.id}`}
      className={cn('block rounded-lg border border-l-[3px] bg-card p-3 shadow-sm transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', style.edge)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{row.companyName || row.applicantName}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(row.amount)}</p>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        <span className="font-mono">{row.reference}</span> · {LOAN_TYPE_LABELS[row.loanType]}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <OutcomeMark outcome={row.prescreenOutcome} className="rounded-full bg-muted/60 px-2 py-0.5" />
        <span className="flex items-center gap-1.5">
          {/* Only when it has moved on since submission; otherwise it repeats the age. */}
          {!age || inStage !== age.age ? (
            <span title={`${inStage} ${inStage === 1 ? 'day' : 'days'} in this stage`} className="text-[11px] tabular-nums text-muted-foreground">
              {inStage}d here
            </span>
          ) : null}
          {age ? (
            <span title={`Open ${age.age} days; target ${slaDays}`} className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', style.badge)}>
              {age.age}d<span className="sr-only">{age.tone === 'overdue' ? ' open, past the target' : age.tone === 'warn' ? ' open, nearing the target' : ' open'}</span>
            </span>
          ) : null}
          {row.assignedOfficerName ? (
            <span title={row.assignedOfficerName} className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              <span aria-hidden="true">{initialsOf(row.assignedOfficerName)}</span>
              <span className="sr-only">Assigned to {row.assignedOfficerName}</span>
            </span>
          ) : (
            <span title="Unassigned" className="inline-flex size-6 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground">
              <span aria-hidden="true">–</span>
              <span className="sr-only">Unassigned</span>
            </span>
          )}
        </span>
      </div>
      {row.sourcedByName && row.sourcedBy !== viewerId ? <p className="mt-2 truncate border-t pt-1.5 text-[11px] text-muted-foreground">via {row.sourcedByName}</p> : null}
    </Link>
  )
}

/** A draft on the board: who, how much, how far they got. Opens the draft window. */
function DraftCard({ row, viewerId, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-lg border border-dashed bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{row.companyName || row.applicantName || row.email}</p>
        {row.amount ? <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(row.amount)}</p> : null}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{LOAN_TYPE_LABELS[row.loanType]}</p>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="h-1.5 flex-1 rounded-full bg-muted" aria-hidden="true">
          <span className="block h-full rounded-full bg-primary/60" style={{ width: `${((row.currentStep + 1) / row.stepCount) * 100}%` }} />
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Step {row.currentStep + 1} of {row.stepCount}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
        Saved {timeAgo(row.lastSavedAt)}
        {row.sourcedByName && row.sourcedBy !== viewerId ? `, via ${row.sourcedByName}` : ''}
      </p>
    </button>
  )
}
