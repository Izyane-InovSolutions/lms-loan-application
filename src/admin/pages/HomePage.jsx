import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Copy, FilePlus2, History, Loader2, UserPlus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ROLES, STAFF_ROLES, roleLabel } from '@/config/roles'
import { LOAN_TYPE_LABELS, LMS_SYNC_LABELS, statusLabel } from '@/config/applications'
import { setAssistedFlag } from '@/lib/assisted'
import { api } from '../api'
import { useAuth } from '../auth'
import { EmptyState, FormError, Initials, PageHeader, Panel, ROLE_TONES, StatusBadge, StatusText, money, timeAgo } from '../components'
import { describeAction } from './AuditPage'
import { KpiStrip, Leaderboard, ProductMix, QueueTiles, RuleOutcomes, StageBreakdown, SubmissionsTrend } from './dashboardCharts'

const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const PERIODS = [7, 30, 90]

/**
 * The signed-in person's dashboard. Every number is limited server-side to what their
 * role may see, so the same components serve an agent's own figures and the whole book.
 */
export function HomePage() {
  const { user } = useAuth()
  const [days, setDays] = useState(30)
  const [data, setData] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setData((prev) => ({ ...prev, status: prev.dashboard ? 'refreshing' : 'loading' }))
    Promise.all([api(`/dashboard?days=${days}`), ['admin', 'rm'].includes(user.role) ? api('/overview') : Promise.resolve(null)])
      .then(([dashboard, overview]) => !cancelled && setData({ status: 'ready', dashboard, overview }))
      .catch((error) => !cancelled && setData({ status: 'error', message: error.message }))
    return () => {
      cancelled = true
    }
  }, [user.role, days])

  // Straight after a demo role switch the previous role's data is still in state for one render.
  const ready = data.dashboard && data.dashboard.role === user.role

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        description={ROLES[user.role]?.description}
        actions={
          <div className="flex rounded-lg border bg-card p-0.5" role="radiogroup" aria-label="Period">
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                role="radio"
                aria-checked={days === period}
                onClick={() => setDays(period)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  days === period ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {period} days
              </button>
            ))}
          </div>
        }
      />
      {data.status === 'error' ? (
        <FormError message={data.message} />
      ) : !ready ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading your dashboard…
        </p>
      ) : (
        <div className={cn('space-y-6 transition-opacity', data.status === 'refreshing' && 'opacity-60')}>
          <RoleDashboard user={user} dashboard={data.dashboard} overview={data.overview} />
        </div>
      )}
    </div>
  )
}

function RoleDashboard({ user, dashboard, overview }) {
  const trend = (
    <Panel title="Applications submitted" description="Per day, by how they came in">
      <SubmissionsTrend trend={dashboard.trend} days={dashboard.days} />
    </Panel>
  )
  const stages = (
    <Panel title="Where they are now" description={`Applications from the last ${dashboard.days} days, by stage`}>
      <StageBreakdown funnel={dashboard.funnel} />
    </Panel>
  )
  const rules = (
    <Panel title="Credit rules" description="How prescreening went">
      <RuleOutcomes outcomes={dashboard.prescreenOutcomes} />
    </Panel>
  )

  if (user.role === 'loan_officer') {
    return (
      <>
        <QueueTiles queue={dashboard.queue} />
        <KpiStrip kpis={dashboard.kpis} days={dashboard.days} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {trend}
          <div className="space-y-6">
            {rules}
            <Panel title="Your judgements" description={`Recommendations and decisions, last ${dashboard.days} days`}>
              <p className="text-3xl font-semibold tabular-nums text-foreground">{dashboard.queue.myJudgements}</p>
              <p className="text-sm text-muted-foreground">{dashboard.queue.myApprovals} of them to approve</p>
            </Panel>
          </div>
        </div>
        {stages}
      </>
    )
  }

  if (user.role === 'dsa' || user.role === 'rm') {
    return (
      <>
        <KpiStrip kpis={dashboard.kpis} days={dashboard.days} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <RecentApplications rows={dashboard.recent} />
          <div className="space-y-6">
            {user.referralCode ? <ReferralPanel code={user.referralCode} /> : null}
            {stages}
          </div>
        </div>
        {user.role === 'rm' ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Your agents’ results">
              <Leaderboard rows={dashboard.leaderboard} />
            </Panel>
            <TeamPanel team={overview?.team || []} />
          </div>
        ) : null}
        {trend}
      </>
    )
  }

  // Admin and sales manager: the whole book.
  return (
    <>
      <KpiStrip kpis={dashboard.kpis} days={dashboard.days} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {trend}
        <div className="space-y-6">
          {rules}
          <Panel title="Products">
            <ProductMix mix={dashboard.mix} />
          </Panel>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {stages}
        <Panel title="Agents and relationship managers" description="Ranked by applications brought in">
          <Leaderboard rows={dashboard.leaderboard} />
        </Panel>
      </div>
      {user.role === 'admin' && overview ? <AdminExtras overview={overview} lmsHealth={dashboard.lmsHealth} /> : null}
    </>
  )
}

function RecentApplications({ rows }) {
  const navigate = useNavigate()
  const start = () => {
    setAssistedFlag()
    navigate('/apply/personal/personal-information')
  }
  return (
    <Panel
      title="Latest applications"
      action={
        <Button size="sm" onClick={start}>
          <FilePlus2 />
          New application
        </Button>
      }
      bodyClassName="p-0"
    >
      {rows?.length ? (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/admin/applications/${row.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{row.applicantName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {money(row.amount)} {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}, {timeAgo(row.submittedAt)}
                  </span>
                </span>
                <StatusBadge status={row.status} label={statusLabel(row.status)} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FilePlus2} title="No applications yet">
          Fill one in with a customer, or share your referral link.
        </EmptyState>
      )}
    </Panel>
  )
}

function TeamPanel({ team }) {
  return (
    <Panel title="Your agents">
      {team.length ? (
        <ul className="divide-y">
          {team.map((agent) => (
            <li key={agent.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Initials name={agent.name} className="bg-secondary text-secondary-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                <p className="truncate text-xs text-muted-foreground">{agent.email}</p>
              </div>
              <StatusText status={agent.status} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Users} title="No agents assigned to you yet">
          An administrator assigns direct sales agents to relationship managers.
        </EmptyState>
      )}
    </Panel>
  )
}

function AdminExtras({ overview, lmsHealth }) {
  const team = useMemo(() => {
    const byRole = Object.fromEntries(STAFF_ROLES.map((role) => [role, { active: 0, invited: 0, disabled: 0 }]))
    overview.userCounts.forEach(({ role, status, count }) => {
      if (byRole[role]) byRole[role][status] = count
    })
    const rows = STAFF_ROLES.map((role) => ({ role, ...byRole[role], total: byRole[role].active + byRole[role].invited }))
    return { rows, total: rows.reduce((sum, row) => sum + row.total, 0), invited: rows.reduce((sum, row) => sum + row.invited, 0) }
  }, [overview.userCounts])
  const lmsEntries = Object.entries(lmsHealth || {})

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel
        title="Your team"
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/users?invite=1">
              <UserPlus />
              Invite
            </Link>
          </Button>
        }
      >
        {team.total === 0 ? (
          <EmptyState icon={Users} title="No staff accounts yet">
            Invite loan officers, relationship managers and agents.
          </EmptyState>
        ) : (
          <TeamComposition team={team} />
        )}
      </Panel>
      <Panel
        title="Recent activity"
        action={
          <Link to="/admin/audit" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Audit log
          </Link>
        }
      >
        {overview.recentActivity.length === 0 ? (
          <EmptyState icon={History} title="Nothing recorded yet" />
        ) : (
          <ol className="relative space-y-4 before:absolute before:inset-y-2 before:left-[5px] before:w-px before:bg-border">
            {overview.recentActivity.slice(0, 6).map((entry) => (
              <li key={entry.id} className="relative pl-6">
                <span className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-card bg-primary/70" aria-hidden="true" />
                <p className="text-sm text-foreground">{describeAction(entry)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.actorLabel.replace(/ <.*>$/, '')}, {timeAgo(entry.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel title="LMS hand-offs">
        {lmsEntries.length ? (
          <ul className="space-y-2 text-sm">
            {lmsEntries.map(([status, count]) => (
              <li key={status} className="flex justify-between">
                <Link to={`/admin/applications?status=all&lms=${status}`} className={cn('hover:underline', ['failed', 'uncertain'].includes(status) ? 'font-medium text-warning' : 'text-muted-foreground')}>
                  {LMS_SYNC_LABELS[status]}
                </Link>
                <span className="tabular-nums text-foreground">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No LMS connected, so nothing to hand off. The workspace runs on its own.</p>
        )}
      </Panel>
    </div>
  )
}



/** One bar split by role, then a row per role — composition first, detail second. */
function TeamComposition({ team }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">{team.total}</p>
        <p className="text-sm text-muted-foreground">
          staff accounts{team.invited ? `, ${team.invited} still to accept their invitation` : ''}
        </p>
      </div>
      <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Staff by role">
        {team.rows
          .filter((row) => row.total)
          .map((row) => (
            <span
              key={row.role}
              className="h-full border-r-2 border-card last:border-r-0"
              style={{ width: `${(row.total / team.total) * 100}%`, background: ROLE_TONES[row.role].bar }}
              title={`${roleLabel(row.role)}: ${row.total}`}
            />
          ))}
      </div>
      <dl className="mt-5 grid gap-y-3">
        {team.rows.map((row) => (
          <div key={row.role} className="flex items-center justify-between gap-3 border-b border-dashed pb-2">
            <dt className="flex items-center gap-2 text-sm text-foreground">
              <span className={cn('size-2 rounded-full', ROLE_TONES[row.role].dot)} aria-hidden="true" />
              {roleLabel(row.role)}
            </dt>
            <dd className="text-sm tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{row.active}</span> active
              {row.invited ? <span className="text-warning">, {row.invited} invited</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}




function ReferralPanel({ code }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/?ref=${code}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Panel title="Your referral link">
      <p className="text-sm text-muted-foreground">
        Customers who apply through this link are credited to you. Share it by message or print the code.
      </p>
      <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate text-sm text-foreground">{link}</code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Code <span className="font-semibold tracking-[0.12em] text-foreground">{code}</span>
      </p>
    </Panel>
  )
}
