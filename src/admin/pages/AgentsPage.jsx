/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowDownToLine, ArrowUp, Banknote, CheckCircle2, FilePen, FileStack, Hourglass, Search, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DEFAULT_PERIOD, QUICK_PERIODS, isPeriod, pastMonths, periodDates, periodLabel as labelOf } from '@/config/reportPeriods'
import { api } from '../api'
import { EmptyState, ErrorState, Initials, PageHeader, SkeletonRows, downloadCsv, money, roleTone, timeAgo } from '../components'

/*
 * Agents: what each agent who brings business in has done — applications brought in,
 * approvals, payouts, what's open and in draft — for a period on the Lusaka calendar: this
 * month, last month, any past month, the last 30, 60 or 90 days, or all time. Each figure
 * counts when its event happened (api/_handlers/reports.js), so a month can be paid on. Relationship managers see the agents who report to
 * them; sales managers and administrators see every agent.
 */


const DESCRIPTIONS = {
  all: 'Every agent’s activity: what they brought in and where it stands now.',
  team: 'The agents who report to you: what they brought in and where it stands now.',
  own: 'Your own activity.',
}

const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)
const days = (value) => (value === null || value === undefined ? '—' : `${value < 10 ? value.toFixed(1) : Math.round(value)}d`)

// Table columns: how each sorts, and how it reads.
const COLUMNS = [
  { key: 'name', label: 'Agent', sort: (a, b) => a.name.localeCompare(b.name), align: 'left' },
  { key: 'submitted', label: 'Brought in', hint: 'Applications submitted in the period' },
  { key: 'approved', label: 'Approved', hint: 'Decided in the period' },
  { key: 'declined', label: 'Declined', hint: 'Decided in the period' },
  { key: 'approvalRate', label: 'Approval rate', hint: 'Approved out of those decided' },
  { key: 'disbursedValue', label: 'Paid out', hint: 'Paid out in the period' },
  { key: 'decisionDays', label: 'To decision', hint: 'Average days from submission to decision, for decisions in the period' },
  { key: 'open', label: 'Open now', hint: 'Being worked right now, whenever submitted' },
  { key: 'drafts', label: 'Drafts', hint: 'Unfinished applications now' },
  { key: 'lastActive', label: 'Last active', sort: (a, b) => new Date(a.lastActive || 0) - new Date(b.lastActive || 0) },
]

export function AgentsPage() {
  const [params, setParams] = useSearchParams()
  const period = isPeriod(params.get('period')) ? params.get('period') : DEFAULT_PERIOD
  const [state, setState] = useState({ status: 'loading' })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' })

  const load = useCallback(() => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, refreshing: true } : { status: 'loading' }))
    api(`/reports/agents?period=${period}`)
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  const setPeriod = (value) => {
    const next = new URLSearchParams(params)
    if (value === DEFAULT_PERIOD) next.delete('period')
    else next.set('period', value)
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = search.trim().toLowerCase()
    const column = COLUMNS.find((entry) => entry.key === sort.key)
    const compare = column?.sort || ((a, b) => (a[sort.key] ?? -1) - (b[sort.key] ?? -1))
    return state.agents
      .filter((agent) => !needle || [agent.name, agent.email, agent.managerName].some((value) => String(value || '').toLowerCase().includes(needle)))
      .slice()
      .sort((a, b) => (sort.dir === 'asc' ? compare(a, b) : compare(b, a)))
  }, [state, search, sort])

  const toggleSort = (key) => setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  const periodName = labelOf(period)
  const dates = periodDates(period)
  const months = useMemo(() => pastMonths(24), [])
  const pickedMonth = period.startsWith('month:') ? period : ''
  const showManager = state.scope === 'all'

  const exportCsv = () =>
    downloadCsv(`agents-${periodName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`, [
      [`Period: ${periodName}${dates ? ` (${dates}, Lusaka time)` : ''}`],
      ['Agent', 'Email', 'Role', ...(showManager ? ['Reports to'] : []), 'Brought in', 'Amount requested (ZMW)', 'Open', 'Open value (ZMW)', 'Approved', 'Declined', 'Approval rate', 'Paid out', 'Paid out value (ZMW)', 'Withdrawn or lapsed', 'Avg days to decision', 'Drafts', 'Last active'],
      ...rows.map((agent) => [
        agent.name,
        agent.email,
        agent.roleLabel,
        ...(showManager ? [agent.managerName || ''] : []),
        agent.submitted,
        agent.requested,
        agent.open,
        agent.openValue,
        agent.approved,
        agent.declined,
        agent.approvalRate === null ? '' : Math.round(agent.approvalRate * 100) + '%',
        agent.disbursed,
        agent.disbursedValue,
        agent.closed,
        agent.decisionDays === null ? '' : agent.decisionDays.toFixed(1),
        agent.drafts,
        agent.lastActive || '',
      ]),
    ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description={DESCRIPTIONS[state.scope] || DESCRIPTIONS.all}
        actions={
          <>
            <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border bg-card p-0.5">
              {QUICK_PERIODS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={period === key}
                  onClick={() => setPeriod(key)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    period === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="w-40">
              <Select aria-label="A past month" value={pickedMonth} onChange={(event) => event.target.value && setPeriod(event.target.value)} className={cn('h-10 text-sm', pickedMonth && 'border-primary ring-1 ring-primary')}>
                <option value="">Pick a month…</option>
                {months.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={state.status !== 'ready' || !rows.length}>
              <ArrowDownToLine />
              Export CSV
            </Button>
          </>
        }
      />

      {state.status === 'loading' ? (
        <SkeletonRows rows={6} />
      ) : state.status === 'error' ? (
        <div className="rounded-xl border bg-card">
          <ErrorState message={state.message} onRetry={load} />
        </div>
      ) : !state.agents.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={Users} title={state.scope === 'team' ? 'No agents report to you yet' : 'No agents yet'}>
            {state.scope === 'team'
              ? 'Agents appear here once an administrator sets you as their manager, in Team.'
              : 'Agents appear here once someone has a role that brings business in, such as direct sales agent.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="-mb-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{periodName}</span>
            {dates ? ` · ${dates}` : ''} · Lusaka time
          </p>
          <Totals totals={state.totals} periodLabel={periodName} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={showManager ? 'Search agent or manager' : 'Search agent'} aria-label="Search agents" className="h-10 pl-9 text-sm" />
            </div>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {rows.length} of {state.agents.length} {state.agents.length === 1 ? 'agent' : 'agents'}
              {state.refreshing ? ', refreshing…' : ''}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn('whitespace-nowrap px-3 py-3 font-medium', column.align === 'left' ? 'text-left' : 'text-right')}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        title={column.hint}
                        className={cn('inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', sort.key === column.key && 'text-foreground')}
                      >
                        {column.label}
                        {sort.key === column.key ? sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" /> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} showManager={showManager} period={period} />
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-muted-foreground">
                      No agent matches “{search}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {rows.length > 1 && !search.trim() ? (
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold text-foreground">
                    <td className="px-3 py-3">Team total</td>
                    <Num value={state.totals.submitted} />
                    <Num value={state.totals.approved} />
                    <Num value={state.totals.declined} />
                    <Num value={percent(state.totals.approvalRate)} />
                    <Num value={money(state.totals.disbursedValue)} />
                    <Num value="" />
                    <Num value={state.totals.open} />
                    <Num value={state.totals.drafts} />
                    <Num value="" />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Each figure counts when it happened, on the Lusaka calendar: brought in when submitted, approved or declined when decided, paid out when paid out. Open now, drafts and last active are as of now. Select an agent for their figures over every period, side by side.
          </p>
        </>
      )}
    </div>
  )
}

/** The team at a glance, for the period. */
function Totals({ totals, periodLabel }) {
  const tiles = [
    { icon: FileStack, label: 'Brought in', value: totals.submitted, detail: `${money(totals.requested)} requested` },
    { icon: Hourglass, label: 'Open now', value: totals.open, detail: `${money(totals.openValue)} being worked` },
    { icon: CheckCircle2, label: 'Approved', value: totals.approved, detail: `${percent(totals.approvalRate)} approval rate` },
    { icon: Banknote, label: 'Paid out', value: totals.disbursed, detail: money(totals.disbursedValue) },
    { icon: FilePen, label: 'Drafts in progress', value: totals.drafts, detail: 'Unfinished, right now' },
    { icon: Users, label: 'Active agents', value: `${totals.active} of ${totals.agents}`, detail: 'Brought in or drafting' },
  ]
  return (
    <section aria-label={`Team totals, ${periodLabel}`} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map(({ icon: Icon, label, value, detail }) => (
        <div key={label} className="rounded-xl border bg-card px-3 py-3 shadow-sm">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      ))}
    </section>
  )
}

const Num = ({ value, muted }) => <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums', muted && 'text-muted-foreground')}>{value}</td>

function AgentRow({ agent, showManager, period }) {
  // Their page in Agents, with this period highlighted.
  const to = `/admin/agents/${agent.id}${period === DEFAULT_PERIOD ? '' : `?period=${period}`}`
  const inactive = !agent.submitted && !agent.drafts
  return (
    <tr className={cn('border-b last:border-b-0 hover:bg-muted/30', inactive && 'text-muted-foreground')}>
      <td className="px-3 py-3">
        <Link to={to} title={agent.managerName ? `${agent.name}, reports to ${agent.managerName}` : agent.name} className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Initials name={agent.name} className={roleTone(agent.role).chip} />
          <span className="min-w-0 max-w-[13rem]">
            <span className="block truncate font-medium text-foreground hover:underline">{agent.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {agent.roleLabel}
              {showManager ? (agent.managerName ? ` · reports to ${agent.managerName}` : ' · no manager') : ''}
              {agent.status === 'disabled' ? ' · switched off' : agent.status === 'invited' ? ' · invited' : ''}
            </span>
          </span>
        </Link>
      </td>
      <Num value={agent.submitted} />
      <Num value={agent.approved} muted={!agent.approved} />
      <Num value={agent.declined} muted={!agent.declined} />
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          {agent.approvalRate !== null ? (
            <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(agent.approvalRate * 100)}%` }} />
            </span>
          ) : null}
          <span className="w-10 text-right tabular-nums">{percent(agent.approvalRate)}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
        {agent.disbursed ? (
          <>
            <span className="font-medium text-foreground">{money(agent.disbursedValue)}</span>
            <span className="block text-xs text-muted-foreground">{agent.disbursed} {agent.disbursed === 1 ? 'loan' : 'loans'}</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <Num value={days(agent.decisionDays)} muted={agent.decisionDays === null} />
      <Num value={agent.open} muted={!agent.open} />
      <Num value={agent.drafts} muted={!agent.drafts} />
      <td className="whitespace-nowrap px-3 py-3 text-right text-muted-foreground">{agent.lastActive ? timeAgo(agent.lastActive) : 'Never'}</td>
    </tr>
  )
}
