import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { LOAN_TYPE_LABELS } from '@/config/applications'
import { api } from '../api'
import { useAuth } from '../auth'
import { FormError, OutcomeMark, PageHeader, daysSince, money } from '../components'

const COLUMNS = [
  { status: 'submitted', label: 'New', accent: 'bg-muted-foreground/60' },
  { status: 'in_review', label: 'In review', accent: 'bg-primary' },
  { status: 'info_requested', label: 'Waiting on applicant', accent: 'bg-warning' },
  { status: 'pending_approval', label: 'Awaiting approval', accent: 'bg-[hsl(262_40%_48%)]' },
  { status: 'approved', label: 'Offer made', accent: 'bg-success' },
  { status: 'accepted', label: 'Accepted', accent: 'bg-success' },
  { status: 'disbursed', label: 'Paid out', accent: 'bg-success' },
  { status: 'declined', label: 'Declined', accent: 'bg-muted-foreground/40' },
  { status: ['withdrawn', 'expired'], label: 'Withdrawn or lapsed', accent: 'bg-muted-foreground/30' },
]

const DESCRIPTIONS = {
  dsa: 'Every customer you’ve brought in, by stage.',
  rm: 'Your customers and your agents’ customers, by stage.',
  sales_manager: 'The whole pipeline, by stage.',
  admin: 'The whole pipeline, by stage.',
}

/** A board of the pipeline by stage. Read-only: only credit staff move cases, from the case page. */
export function PipelinePage() {
  const { user } = useAuth()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    api('/applications?status=&pageSize=200&sort=updated')
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [])

  const columns = useMemo(() => {
    if (state.status !== 'ready') return []
    return COLUMNS.map((column) => {
      const statuses = [].concat(column.status)
      const cards = state.applications.filter((row) => statuses.includes(row.status))
      return { ...column, cards, value: cards.reduce((sum, row) => sum + row.amount, 0) }
    })
  }, [state])

  return (
    <div className="space-y-6">
      <PageHeader title="Pipeline" description={DESCRIPTIONS[user.role]} />
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
              <section key={column.label} aria-labelledby={`col-${column.label}`} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 dark:bg-card/40">
                <header className="px-4 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', column.accent)} aria-hidden="true" />
                    <h2 id={`col-${column.label}`} className="text-sm font-semibold text-foreground">
                      {column.label}
                    </h2>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{column.cards.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{money(column.value)}</p>
                </header>
                <ol className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {column.cards.length === 0 ? <li className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</li> : null}
                  {column.cards.map((row) => (
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
                        {row.sourcedByName && user.role !== 'dsa' ? <p className="mt-1.5 truncate text-[11px] text-muted-foreground">via {row.sourcedByName}</p> : null}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
