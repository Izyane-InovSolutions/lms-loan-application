/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, Clock, FilePen, FileStack, Hourglass, Mail, Phone, UserRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LOAN_TYPE_LABELS, statusLabel } from '@/config/applications'
import { DEFAULT_PERIOD, isPeriod, periodDates } from '@/config/reportPeriods'
import { api } from '../api'
import { EmptyState, ErrorState, Initials, Panel, SkeletonRows, StatusBadge, dateTime, downloadCsv, money, roleTone, timeAgo } from '../components'

/*
 * One agent, inside Agents: every figure for this month, last month, the last 30, 60 and
 * 90 days and all time side by side (and a past month, if one was chosen on the list), on
 * the Lusaka calendar and each counted when it happened; what they have on right now; and
 * their latest applications. The period chosen on the Agents list is highlighted.
 */


const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)
const days = (value) => (value === null || value === undefined ? '—' : `${value < 10 ? value.toFixed(1) : Math.round(value)} days`)

/**
 * The comparison's rows. `bar` rows show how each period compares with all time, so the
 * eye reads the trend before the numbers.
 */
const METRICS = [
  { key: 'submitted', label: 'Applications brought in', hint: 'Submitted in the period', bar: true },
  { key: 'requested', label: 'Amount requested', format: money, bar: true },
  { key: 'personal', label: 'Personal loans', bar: true },
  { key: 'business', label: 'Business loans', bar: true },
  { key: 'approved', label: 'Approved', hint: 'Decided in the period', bar: true },
  { key: 'declined', label: 'Declined', hint: 'Decided in the period', bar: true },
  { key: 'approvalRate', label: 'Approval rate', hint: 'Approved out of those decided', format: percent },
  { key: 'disbursed', label: 'Paid out', hint: 'Paid out in the period', bar: true },
  { key: 'disbursedValue', label: 'Paid-out value', format: money, bar: true },
  { key: 'closed', label: 'Withdrawn or lapsed', hint: 'In the period', bar: true },
  { key: 'decisionDays', label: 'Average time to decision', hint: 'For decisions in the period', format: days },
]

export function AgentDetailPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const highlighted = isPeriod(params.get('period')) ? params.get('period') : DEFAULT_PERIOD
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(() => {
    setState({ status: 'loading' })
    api(`/reports/agents/${id}${highlighted === DEFAULT_PERIOD ? '' : `?period=${encodeURIComponent(highlighted)}`}`)
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((error) => setState({ status: 'error', message: error.message, notFound: error.status === 404 }))
  }, [id, highlighted])

  useEffect(() => {
    load()
  }, [load])

  const back = `/admin/agents${highlighted === DEFAULT_PERIOD ? '' : `?period=${highlighted}`}`

  return (
    <div className="space-y-6">
      <Link to={back} className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All agents
      </Link>

      {state.status === 'loading' ? (
        <SkeletonRows rows={6} />
      ) : state.status === 'error' ? (
        <div className="rounded-xl border bg-card">
          {state.notFound ? (
            <EmptyState icon={UserRound} title="Agent not found">
              They may have moved to another team, or their role no longer brings business in.
            </EmptyState>
          ) : (
            <ErrorState message={state.message} onRetry={load} />
          )}
        </div>
      ) : (
        <AgentView {...state} highlighted={highlighted} />
      )}
    </div>
  )
}

function AgentView({ agent, periods, recent, scope, highlighted: chosen }) {
  // A month picked on the list that is last month shows as "Last month".
  const highlighted = periods.some((column) => column.period === chosen) ? chosen : periods.find((column) => column.dates && column.dates === periodDates(chosen))?.period || chosen
  const allTime = periods.find((column) => column.period === 'all')
  const applicationsLink = `/admin/applications?status=all&sourcedBy=${agent.id}&agent=${encodeURIComponent(agent.name)}`

  const exportCsv = () =>
    downloadCsv(`agent-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Measure', ...periods.map((column) => (column.dates ? `${column.label} (${column.dates})` : column.label))],
      ...METRICS.map((metric) => [metric.label, ...periods.map((column) => exportValue(metric, column[metric.key]))]),
    ])

  return (
    <>
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Initials name={agent.name} className={cn('size-14 text-base', roleTone(agent.role).chip)} />
          <div className="min-w-0">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">{agent.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.roleLabel}
              {scope === 'all' ? (agent.managerName ? ` · reports to ${agent.managerName}` : ' · no manager') : ''}
              {agent.status === 'deleted' ? ' · account deleted' : agent.status === 'disabled' ? ' · switched off' : agent.status === 'invited' ? ' · invited, not signed in yet' : ''}
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {agent.email ? (
                <a href={`mailto:${agent.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="size-3.5" aria-hidden="true" />
                  {agent.email}
                </a>
              ) : null}
              {agent.phone ? (
                <a href={`tel:${agent.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-3.5" aria-hidden="true" />
                  {agent.phone}
                </a>
              ) : null}
              {agent.joinedAt ? <span>Joined {dateTime(agent.joinedAt).split(',')[0]}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <ArrowDownToLine />
            Export CSV
          </Button>
          <Button asChild>
            <Link to={applicationsLink}>
              <FileStack />
              Their applications
            </Link>
          </Button>
        </div>
      </header>

      <section aria-label="Right now" className="grid gap-3 sm:grid-cols-3">
        <NowTile icon={Hourglass} label="Open now" value={agent.open} detail={`${money(agent.openValue)} being worked`} />
        <NowTile icon={FilePen} label="Drafts in progress" value={agent.drafts} detail={agent.drafts ? `${money(agent.draftsValue)} not yet submitted` : 'Nothing unfinished'} />
        <NowTile icon={Clock} label="Last active" value={agent.lastActive ? timeAgo(agent.lastActive) : 'Never'} detail={agent.lastActive ? dateTime(agent.lastActive) : 'No applications or drafts yet'} />
      </section>

      <Panel title="By period" description="On the Lusaka calendar, each figure counted when it happened: brought in when submitted, approved or declined when decided, paid out when paid out." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="px-5 py-3 text-left font-medium">
                  Measure
                </th>
                {periods.map((column) => (
                  <th key={column.period} scope="col" className={cn('px-4 py-3 text-right align-bottom font-medium', column.period === highlighted && 'bg-primary/[0.06] text-foreground')}>
                    {column.label}
                    {column.dates ? <span className="block whitespace-nowrap text-[11px] font-normal text-muted-foreground">{column.dates}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <tr key={metric.key} className="border-b last:border-b-0">
                  <th scope="row" className="px-5 py-3 text-left font-normal text-foreground">
                    {metric.label}
                    {metric.hint ? <span className="block text-xs text-muted-foreground">{metric.hint}</span> : null}
                  </th>
                  {periods.map((column) => (
                    <PeriodCell key={column.period} metric={metric} value={column[metric.key]} ofAll={allTime[metric.key]} highlighted={column.period === highlighted} isAll={column.period === 'all'} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Latest applications"
        action={
          recent.length ? (
            <Link to={applicationsLink} className="text-sm font-medium text-primary hover:underline">
              See all
            </Link>
          ) : null
        }
        bodyClassName="p-0"
      >
        {recent.length ? (
          <ul className="divide-y">
            {recent.map((row) => (
              <li key={row.id}>
                <Link to={`/admin/applications/${row.id}`} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{row.companyName || row.applicantName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{row.reference}</span> · {LOAN_TYPE_LABELS[row.loanType]} · {timeAgo(row.submittedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">{money(row.amount)}</span>
                  <span className="hidden w-36 shrink-0 text-right sm:block"><StatusBadge status={row.status} label={statusLabel(row.status)} /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No applications brought in yet.</p>
        )}
      </Panel>
    </>
  )
}

function NowTile({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

/** One figure, with a bar of its share of all time for the counts and amounts. */
function PeriodCell({ metric, value, ofAll, highlighted, isAll }) {
  const shown = metric.format ? metric.format(value) : value
  const share = metric.bar && ofAll ? Math.min(1, (value || 0) / ofAll) : null
  return (
    <td className={cn('px-4 py-3 text-right align-top', highlighted && 'bg-primary/[0.06]')}>
      <span className={cn('tabular-nums', value ? 'font-medium text-foreground' : 'text-muted-foreground', highlighted && 'font-semibold')}>{shown}</span>
      {share !== null && !isAll ? (
        <span className="ml-auto mt-1.5 block h-1 w-16 overflow-hidden rounded-full bg-muted" title={`${Math.round(share * 100)}% of all time`} aria-hidden="true">
          <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      ) : null}
    </td>
  )
}

const exportValue = (metric, value) => {
  if (value === null || value === undefined) return ''
  if (metric.key === 'approvalRate') return `${Math.round(value * 100)}%`
  if (metric.key === 'decisionDays') return value.toFixed(1)
  return value
}
