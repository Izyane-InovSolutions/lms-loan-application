import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlarmClock, ArrowDownRight, ArrowUpRight, Banknote, Briefcase, CheckCircle2, Clock, FileText, Gavel, Hourglass, Inbox, Minus, PieChart as PieIcon, UserCheck, UserX } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CHANNELS, LOAN_TYPE_LABELS, statusLabel } from '@/config/applications'
import { roleLabel } from '@/config/roles'
import { money } from '../components'
import { Donut, ShareMeter, Sparkline, periodDays } from './dashboardVisuals'

// Series follow the channel, never its rank: a filter that hides one never repaints the others.
export const CHANNEL_SERIES = [
  { key: 'self', label: CHANNELS.self, color: 'var(--viz-1)' },
  { key: 'dsa', label: CHANNELS.dsa, color: 'var(--viz-2)' },
  { key: 'rm', label: CHANNELS.rm, color: 'var(--viz-3)' },
  // Everyone else who brings business in: sales managers and roles an admin added.
  { key: 'other', label: 'Other staff', color: 'hsl(262 40% 52%)' },
]

const seriesFor = (channel) => (CHANNEL_SERIES.some((entry) => entry.key === channel) ? channel : 'other')

const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)
const hours = (value) => {
  if (value === null || value === undefined) return '—'
  if (value < 48) return `${Math.round(value)} h`
  return `${(value / 24).toFixed(1)} days`
}

/** Change against the previous period, with direction and whether that is good. */
function Delta({ current, previous, higherIsBetter = true, format = (value) => value }) {
  if (previous === null || previous === undefined || current === null || current === undefined) return null
  const diff = current - previous
  if (Math.abs(diff) < 1e-9) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden="true" />
        same as before
      </span>
    )
  }
  const good = diff > 0 === higherIsBetter
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-success' : 'text-warning')}>
      <Icon className="size-3.5" aria-hidden="true" />
      {diff > 0 ? '+' : '−'}
      {format(Math.abs(diff))} vs previous
    </span>
  )
}

// The open pipeline in three parts (three colours, the most a ring can carry safely).
const PIPELINE_GROUPS = [
  { key: 'new', label: 'New', statuses: ['submitted'], color: 'var(--viz-1)' },
  { key: 'assessing', label: 'Assessing', statuses: ['in_review', 'pending_approval'], color: 'var(--viz-3)' },
  { key: 'waiting', label: 'With applicant', statuses: ['info_requested'], color: 'var(--viz-2)' },
]

const compactMoney = (value) => {
  if (!value) return 'K0'
  if (value >= 1e6) return `K${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}m`
  if (value >= 1e3) return `K${Math.round(value / 1e3)}k`
  return money(value)
}

function KpiCell({ icon: Icon, label, value, delta, hint, chart, className }) {
  return (
    // Two columns (the fifth across both) until there is room for all five in a row.
    <div className={cn('flex flex-col border-b p-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:last:col-span-2 sm:last:border-r-0 xl:last:col-span-1 xl:border-b-0 xl:border-r xl:last:border-r-0', className)}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        {label}
      </p>
      <p className="mt-2.5 text-[1.65rem] font-semibold leading-none tabular-nums tracking-tight text-foreground">{value}</p>
      <div className="mt-2 min-h-[1rem]">{delta || (hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null)}</div>
      {delta && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {chart ? <div className="mt-auto pt-4">{chart}</div> : null}
    </div>
  )
}

/**
 * The period's headline numbers as one strip, each with its own small chart: the days of
 * the period for a count or a value, a ring for a split of a whole.
 */
export function KpiStrip({ kpis, days, trend = [], decisions = [], openByStatus = [] }) {
  const { current, previous, pipeline } = kpis
  const calendar = periodDays(days)
  const submittedByDay = new Map()
  trend.forEach((row) => submittedByDay.set(row.day, (submittedByDay.get(row.day) || 0) + row.count))
  const decided = new Map(decisions.map((row) => [row.day, row]))
  const series = (pick) => calendar.map((day) => ({ day, value: pick(day) }))
  const open = PIPELINE_GROUPS.map((group) => ({
    ...group,
    value: openByStatus.filter((row) => group.statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0),
  }))

  return (
    <section aria-label="Key figures" className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-5">
      <KpiCell
        icon={FileText}
        label={`Submitted, last ${days} days`}
        value={current.submitted.toLocaleString()}
        delta={<Delta current={current.submitted} previous={previous.submitted} />}
        chart={<Sparkline data={series((day) => submittedByDay.get(day) || 0)} format={(value) => `${value} submitted`} label={`Applications submitted per day, last ${days} days`} />}
      />
      <KpiCell
        icon={CheckCircle2}
        label="Approval rate"
        value={percent(current.approvalRate)}
        delta={<Delta current={current.approvalRate} previous={previous.approvalRate} format={(diff) => `${Math.round(diff * 100)} pts`} />}
        chart={
          <Donut
            size={48}
            compact
            slices={[
              { key: 'approved', label: 'Approved', value: current.approved, color: 'hsl(var(--success))' },
              { key: 'declined', label: 'Declined', value: current.declined, color: 'hsl(var(--muted-foreground) / 0.55)' },
            ]}
          />
        }
      />
      <KpiCell
        icon={Banknote}
        label="Value approved"
        value={money(current.approvedValue)}
        delta={<Delta current={current.approvedValue} previous={previous.approvedValue} format={money} />}
        chart={<Sparkline kind="bars" data={series((day) => decided.get(day)?.approvedValue || 0)} format={money} label={`Value approved per day, last ${days} days`} />}
      />
      <KpiCell
        icon={Clock}
        label="Time to decision"
        value={hours(current.decisionHours)}
        delta={<Delta current={current.decisionHours} previous={previous.decisionHours} higherIsBetter={false} format={hours} />}
        hint="Average, submit to decision"
        chart={<Sparkline kind="line" data={series((day) => decided.get(day)?.decisionHours ?? null)} format={(value) => `${hours(value)} on average`} label={`Average time to decision per day, last ${days} days`} />}
      />
      <KpiCell
        icon={PieIcon}
        label="Open pipeline"
        value={money(pipeline.value)}
        hint={`${pipeline.count} open applications`}
        chart={<Donut size={48} compact slices={open} />}
      />
    </section>
  )
}

function Legend({ series }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
      {series.map((entry) => (
        <li key={entry.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, entry) => sum + (entry.value || 0), 0)
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lift">
      <p className="font-medium">{new Date(label).toLocaleDateString('en-ZM', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      <ul className="mt-1 space-y-0.5">
        {[...payload].reverse().map((entry) => (
          <li key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
              {entry.name}
            </span>
            <span className="tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex justify-between border-t pt-1 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{total}</span>
      </p>
    </div>
  )
}

/** Submissions per day, stacked by channel, with a table view for screen readers and exports. */
export function SubmissionsTrend({ trend, days }) {
  const [asTable, setAsTable] = useState(false)
  const data = useMemo(() => {
    const byDay = new Map()
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - offset)
      const key = date.toISOString().slice(0, 10)
      byDay.set(key, { day: key, ...Object.fromEntries(CHANNEL_SERIES.map((entry) => [entry.key, 0])) })
    }
    trend.forEach((row) => {
      const bucket = byDay.get(row.day)
      if (bucket) bucket[seriesFor(row.channel)] += row.count
    })
    return [...byDay.values()]
  }, [trend, days])
  const total = data.reduce((sum, row) => sum + CHANNEL_SERIES.reduce((daySum, entry) => daySum + row[entry.key], 0), 0)
  // "Other staff" only appears once someone outside the three usual channels brings business in.
  const series = CHANNEL_SERIES.filter((entry) => entry.key !== 'other' || data.some((row) => row.other))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Legend series={series} />
        <button type="button" onClick={() => setAsTable((value) => !value)} className="text-xs font-medium text-primary hover:underline">
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Day</th>
                {series.map((entry) => (
                  <th key={entry.key} className="py-1 text-right font-medium">
                    {entry.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((row) => (
                <tr key={row.day} className="border-t">
                  <td className="py-1">{row.day}</td>
                  {series.map((entry) => (
                    <td key={entry.key} className="py-1 text-right">
                      {row[entry.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label={`${total} applications submitted over the last ${days} days, by channel`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap={days > 60 ? 1 : 3}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value) => new Date(value).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short' })}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
              {series.map((entry, index) => (
                <Bar
                  key={entry.key}
                  dataKey={entry.key}
                  name={entry.label}
                  stackId="channels"
                  fill={entry.color}
                  stroke="hsl(var(--card))"
                  strokeWidth={1}
                  radius={index === series.length - 1 ? [3, 3, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

const FUNNEL_ORDER = ['submitted', 'in_review', 'info_requested', 'pending_approval', 'approved', 'accepted', 'disbursed', 'declined', 'withdrawn', 'expired']

/** Where this period's applications are now, as proportional bars with the count and value beside each. */
export function StageBreakdown({ funnel }) {
  const rows = FUNNEL_ORDER.map((status) => funnel.find((row) => row.status === status) || { status, count: 0, value: 0 })
  const max = Math.max(1, ...rows.map((row) => row.count))
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.status}>
          <Link to={`/admin/applications?status=${row.status}`} className="group grid grid-cols-[9.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="truncate text-muted-foreground group-hover:text-foreground">{statusLabel(row.status)}</span>
            <span className="h-2.5 rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', row.status === 'declined' ? 'bg-muted-foreground/50' : 'bg-[var(--viz-1)]')}
                style={{ width: `${(row.count / max) * 100}%`, minWidth: row.count ? '6px' : 0 }}
              />
            </span>
            <span className="text-right tabular-nums text-foreground" title={money(row.value)}>
              {row.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// Prescreening verdicts are states, so they wear the status colours, each named beside the ring.
const OUTCOMES = [
  { key: 'pass', label: 'Passed', color: 'hsl(var(--success))' },
  { key: 'refer', label: 'Referred', color: 'hsl(var(--warning))' },
  { key: 'decline', label: 'Decline advised', color: 'hsl(var(--destructive))' },
]

/** The credit rules' verdicts as a ring, with each count and share named beside it. */
export function RuleOutcomes({ outcomes }) {
  const total = OUTCOMES.reduce((sum, entry) => sum + (outcomes[entry.key] || 0), 0)
  if (!total) return <p className="text-sm text-muted-foreground">No applications prescreened in this period.</p>
  return (
    <Donut
      size={104}
      center={
        <span>
          <span className="block text-lg leading-none">{total}</span>
          <span className="text-[0.65rem] font-normal text-muted-foreground">checked</span>
        </span>
      }
      slices={OUTCOMES.map((entry) => ({ ...entry, value: outcomes[entry.key] || 0 }))}
      format={(value) => `${value} · ${Math.round((value / total) * 100)}%`}
    />
  )
}

/** Personal against business lending this period, by value, with counts beside. */
export function ProductMix({ mix }) {
  const rows = ['personal', 'business'].map((type, index) => {
    const row = mix.find((entry) => entry.loanType === type) || { count: 0, value: 0 }
    return { key: type, label: LOAN_TYPE_LABELS[type], value: row.value, count: row.count, color: index === 0 ? 'var(--viz-1)' : 'var(--viz-2)' }
  })
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return (
    <div className="space-y-3">
      <Donut
        size={104}
        center={
          <span>
            <span className="block text-sm leading-none">{compactMoney(total)}</span>
            <span className="text-[0.65rem] font-normal text-muted-foreground">applied for</span>
          </span>
        }
        slices={rows}
        format={money}
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Briefcase className="size-3.5" aria-hidden="true" />
        {rows.map((row) => `${row.count} ${row.label.toLowerCase()}`).join(' · ')}
      </p>
    </div>
  )
}

/** Agents and RMs ranked by applications brought in, with conversion and value. */
export function Leaderboard({ rows }) {
  if (!rows?.length) return <p className="text-sm text-muted-foreground">No referred or assisted applications in this period.</p>
  const max = Math.max(1, ...rows.map((row) => row.approvedValue))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Person</th>
            <th className="pb-2 pl-3 text-right font-medium">Brought in</th>
            <th className="pb-2 pl-3 text-right font-medium">Approved</th>
            <th className="pb-2 pl-3 text-right font-medium">Conversion</th>
            <th className="w-40 pb-2 pl-4 font-medium">Value approved</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="py-2.5">
                <span className="mr-2 inline-block w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="font-medium text-foreground">{row.name}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{roleLabel(row.role)}</span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{row.submitted}</td>
              <td className="py-2.5 text-right tabular-nums">{row.approved}</td>
              <td className="py-2.5 text-right tabular-nums">{percent(row.conversion)}</td>
              <td className="py-2.5 pl-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 flex-1 rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-[var(--viz-2)]" style={{ width: `${(row.approvedValue / max) * 100}%` }} />
                  </span>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{money(row.approvedValue)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The officer's work, each figure a way into the filtered list, with its share of all open cases. */
export function QueueTiles({ queue, openCount = 0 }) {
  const tiles = [
    { icon: Inbox, label: 'In your queue', value: queue.inMyQueue ?? 0, to: '/admin/applications?assigned=queue', hint: 'Cases at the stages you work on' },
    { icon: UserX, label: 'Unassigned', value: queue.unassigned, to: '/admin/applications?assigned=unassigned', hint: 'Waiting for an officer' },
    { icon: UserCheck, label: 'Assigned to you', value: queue.mine, to: '/admin/applications?assigned=me', hint: 'Open cases you own' },
    { icon: Gavel, label: 'Awaiting a decision', value: queue.awaitingDecision, to: '/admin/applications?status=pending_approval', hint: 'Recommended, need a second approver' },
    { icon: Hourglass, label: 'Waiting on applicants', value: queue.waitingOnApplicant, to: '/admin/applications?status=info_requested', hint: 'Information requested' },
    { icon: AlarmClock, label: `Open over ${queue.slaDays} days`, value: queue.overdue, to: '/admin/applications?sort=oldest', hint: 'Past the target', alert: queue.overdue > 0 },
  ]
  return (
    <section aria-label="Your queue" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => {
        const Icon = tile.icon
        return (
          <Link
            key={tile.label}
            to={tile.to}
            className={cn(
              'group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tile.alert && 'border-brand/40 bg-brand/5'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tile.alert ? 'bg-brand/10 text-brand' : 'bg-primary/10 text-primary')}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
            </div>
            <p className={cn('mt-1 text-3xl font-semibold tabular-nums tracking-tight', tile.alert ? 'text-brand' : 'text-foreground')}>{tile.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
            <ShareMeter value={tile.value} total={openCount} tone={tile.alert ? 'alert' : 'primary'} label={`${tile.value} of ${openCount} open cases`} />
          </Link>
        )
      })}
    </section>
  )
}
