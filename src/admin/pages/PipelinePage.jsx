import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { LOAN_TYPE_LABELS } from '@/config/applications'
import { hasPermission } from '@/config/roles'
import { api } from '../api'
import { useAuth } from '../auth'
import { FormError, OutcomeMark, PageHeader, daysSince, money, timeAgo } from '../components'
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

// By what the viewer's role lets them see.
const DESCRIPTIONS = {
  own: 'Every customer you’ve brought in, by stage.',
  team: 'Your customers and your agents’ customers, by stage.',
  all: 'The whole pipeline, by stage.',
}

/**
 * A board of the pipeline by stage, starting with drafts (for roles with drafts.view).
 * Read-only: cases move from the case page, drafts from their own window.
 */
export function PipelinePage() {
  const { user, workflow } = useAuth()
  const [state, setState] = useState({ status: 'loading' })
  const [openDraft, setOpenDraft] = useState(null)
  const showDrafts = hasPermission(user, 'drafts.view')

  const load = useCallback(() => {
    Promise.all([api('/applications?status=&pageSize=200&sort=updated'), showDrafts ? api('/drafts') : Promise.resolve({ drafts: [] })])
      .then(([data, { drafts }]) => setState({ status: 'ready', ...data, drafts }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [showDrafts])

  useEffect(() => {
    load()
  }, [load])

  const columns = useMemo(() => {
    if (state.status !== 'ready' || !workflow) return []
    const withValue = (column) => ({ ...column, value: column.cards.reduce((sum, row) => sum + (row.amount || 0), 0) })
    const board = workflowColumns(workflow, state.applications).map(withValue)
    if (!showDrafts) return board
    return [withValue({ ...DRAFT_COLUMN, cards: state.drafts }), ...board]
  }, [state, showDrafts, workflow])

  return (
    <div className="space-y-6">
      <PageHeader title="Pipeline" description={DESCRIPTIONS[user.scope]} />
      {state.status === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading the pipeline…
        </p>
      ) : state.status === 'error' ? (
        <FormError message={state.message} />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex min-w-max gap-4">
            {columns.map((column) => (
              <section key={column.key || column.label} aria-labelledby={`col-${column.key || column.label}`} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 dark:bg-card/40">
                <header className="px-4 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', column.accent)} aria-hidden="true" />
                    <h2 id={`col-${column.key || column.label}`} className="text-sm font-semibold text-foreground">
                      {column.label}
                    </h2>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{column.cards.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{money(column.value)}</p>
                </header>
                <ol className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {column.cards.length === 0 ? <li className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</li> : null}
                  {column.key === 'draft'
                    ? column.cards.map((row) => (
                        <li key={row.id}>
                          <DraftCard row={row} viewerId={user.id} onOpen={() => setOpenDraft(row.id)} />
                        </li>
                      ))
                    : null}
                  {column.key !== 'draft' && column.cards.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={`/admin/applications/${row.id}`}
                        className="block rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="truncate text-sm font-medium text-foreground">{row.companyName || row.applicantName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {money(row.amount)} {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <OutcomeMark outcome={row.prescreenOutcome} />
                          <span className="text-[11px] text-muted-foreground">{daysSince(row.submittedAt)}d</span>
                        </div>
                        {row.sourcedByName && row.sourcedBy !== user.id ? <p className="mt-1.5 truncate text-[11px] text-muted-foreground">via {row.sourcedByName}</p> : null}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      )}
      <DraftDialog draftId={openDraft} onOpenChange={(open) => !open && setOpenDraft(null)} onChanged={load} />
    </div>
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
      <p className="truncate text-sm font-medium text-foreground">{row.companyName || row.applicantName || row.email}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {row.amount ? `${money(row.amount)} ` : ''}
        {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}
      </p>
      <div className="mt-2 flex items-center gap-2">
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
