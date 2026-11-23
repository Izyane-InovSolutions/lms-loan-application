import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Copy, FilePlus2, History, Loader2, UserPlus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { applyPath } from '@/config/applicationSteps'
import { hasPermission, registeredRoles, roleDescription, roleLabel } from '@/config/roles'
import { LOAN_TYPE_LABELS, LMS_SYNC_LABELS, statusLabel } from '@/config/applications'
import { setAssistedFlag } from '@/lib/assisted'
import { api } from '../api'
import { useAuth } from '../auth'
import { EmptyState, FormError, Initials, Panel, roleTone, StatusBadge, StatusText, money, timeAgo } from '../components'
import { AssistedApplicationTypeDialog } from '../AssistedApplicationTypeDialog'
import { describeAction } from './AuditPage'
import { KpiStrip, Leaderboard, ProductMix, QueueTiles, RuleOutcomes, StageBreakdown, SubmissionsTrend } from './dashboardCharts'
import { DashboardIllustration } from './dashboardVisuals'

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
    const wantsOverview = hasPermission(user, 'audit.view') || hasPermission(user, 'team.lead')
    Promise.all([api(`/dashboard?days=${days}`), wantsOverview ? api('/overview') : Promise.resolve(null)])
      .then(([dashboard, overview]) => !cancelled && setData({ status: 'ready', dashboard, overview }))
      .catch((error) => !cancelled && setData({ status: 'error', message: error.message }))
    return () => {
      cancelled = true
    }
  }, [user, days])

  // Straight after a demo role switch the previous role's data is still in state for one render.
  const ready = data.dashboard && data.dashboard.role === user.role

  return (
    <div className="space-y-6">
      <WelcomeBanner
        name={user.name.split(' ')[0]}
        role={roleDescription(user.role)}
        summary={ready ? summaryLine(data.dashboard) : null}
        period={
          <div className="inline-flex rounded-lg bg-primary-foreground/10 p-0.5 ring-1 ring-primary-foreground/20" role="radiogroup" aria-label="Period">
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                role="radio"
                aria-checked={days === period}
                onClick={() => setDays(period)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground',
                  days === period ? 'bg-primary-foreground text-primary' : 'text-primary-foreground/80 hover:text-primary-foreground'
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

/** One line on what needs attention: the queue for credit staff, else the period's flow. */
const summaryLine = (dashboard) => {
  const parts = []
  if (dashboard.queue) {
    parts.push(`${dashboard.queue.inMyQueue ?? 0} ${dashboard.queue.inMyQueue === 1 ? 'case' : 'cases'} in your queue`)
    if (dashboard.queue.awaitingDecision) parts.push(`${dashboard.queue.awaitingDecision} awaiting a decision`)
    if (dashboard.queue.overdue) parts.push(`${dashboard.queue.overdue} past the ${dashboard.queue.slaDays}-day target`)
  } else {
    parts.push(`${dashboard.kpis.current.submitted} submitted in the last ${dashboard.days} days`)
    parts.push(`${dashboard.kpis.pipeline.count} open`)
  }
  if (dashboard.drafts?.count) parts.push(`${dashboard.drafts.count} ${dashboard.drafts.count === 1 ? 'draft' : 'drafts'} to follow up`)
  return parts.join(' · ')
}

/** The greeting, in the brand's colour, with what needs attention and the period picker. */
function WelcomeBanner({ name, role, summary, period }) {
  return (
    <header className="relative overflow-hidden rounded-2xl bg-primary px-6 py-6 text-primary-foreground shadow-soft sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-primary-foreground/10 blur-2xl" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">{new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1.5 text-[1.75rem] font-semibold leading-tight tracking-tight">
            {greeting()}, {name}
          </h1>
          <p className="mt-1 text-sm text-primary-foreground/80">{role}</p>
          {summary ? <p className="mt-3 inline-flex rounded-full bg-primary-foreground/15 px-3 py-1 text-sm font-medium">{summary}</p> : null}
          <div className="mt-4">{period}</div>
        </div>
        <DashboardIllustration className="hidden h-32 w-auto shrink-0 text-primary-foreground md:block lg:h-36" />
      </div>
    </header>
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
    <Panel title="Policy rules" description="How prescreening went">
      <RuleOutcomes outcomes={dashboard.prescreenOutcomes} />
    </Panel>
  )

  const may = (permission) => hasPermission(user, permission)

  // Credit staff who don't follow sales: their queue first.
  if (may('cases.work') && !may('reports.team')) {
    return (
      <>
        <QueueTiles queue={dashboard.queue} openCount={dashboard.kpis.pipeline.count} />
        <KpiStrip kpis={dashboard.kpis} days={dashboard.days} trend={dashboard.trend} decisions={dashboard.decisions} openByStatus={dashboard.openByStatus} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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

  // People who bring business in and see only their own or their team's.
  if (may('applications.assist') && user.scope !== 'all') {
    return (
      <>
        <KpiStrip kpis={dashboard.kpis} days={dashboard.days} trend={dashboard.trend} decisions={dashboard.decisions} openByStatus={dashboard.openByStatus} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <RecentApplications rows={dashboard.recent} choosesLoanType={may('team.lead')} />
          <div className="space-y-6">
            {dashboard.drafts ? <DraftsPanel drafts={dashboard.drafts} /> : null}
            {user.referralCode ? <ReferralPanel code={user.referralCode} /> : null}
            {stages}
          </div>
        </div>
        {may('team.lead') ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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

  // Admin and sales manager: the whole book, plus whatever else their role covers.
  return (
    <>
      {dashboard.queue ? <QueueTiles queue={dashboard.queue} openCount={dashboard.kpis.pipeline.count} /> : null}
      <KpiStrip kpis={dashboard.kpis} days={dashboard.days} trend={dashboard.trend} decisions={dashboard.decisions} openByStatus={dashboard.openByStatus} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {trend}
        <div className="space-y-6">
          {dashboard.drafts ? <DraftsPanel drafts={dashboard.drafts} /> : null}
          {rules}
          <Panel title="Products">
            <ProductMix mix={dashboard.mix} />
          </Panel>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {stages}
        {dashboard.leaderboard ? (
          <Panel title="Agents and relationship managers" description="Ranked by applications brought in">
            <Leaderboard rows={dashboard.leaderboard} />
          </Panel>
        ) : null}
      </div>
      {may('applications.assist') ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <RecentApplications rows={dashboard.recent} choosesLoanType={may('team.lead')} />
          <div className="space-y-6">
            {user.referralCode ? <ReferralPanel code={user.referralCode} /> : null}
            {may('team.lead') && overview?.team?.length ? <TeamPanel team={overview.team} /> : null}
          </div>
        </div>
      ) : null}
      {overview?.userCounts ? <AdminExtras overview={overview} lmsHealth={dashboard.lmsHealth} /> : null}
    </>
  )
}

/** Unfinished applications to follow up, with a way to the pipeline's Draft column. */
function DraftsPanel({ drafts }) {
  return (
    <Panel
      title="Drafts in progress"
      description="Started, not yet submitted"
      action={
        <Link to="/admin/pipeline" className="text-xs font-medium text-primary hover:underline">
          Open the pipeline
        </Link>
      }
    >
      <p className="text-3xl font-semibold tabular-nums text-foreground">{drafts.count}</p>
      <p className="text-sm text-muted-foreground">{drafts.value ? `${money(drafts.value)} asked for so far` : 'Follow them up from the Draft column.'}</p>
    </Panel>
  )
}

function RecentApplications({ rows, choosesLoanType }) {
  const navigate = useNavigate()
  const [chooseType, setChooseType] = useState(false)
  const start = (loanType = 'personal') => {
    setAssistedFlag()
    navigate(applyPath(loanType, 0))
  }
  const begin = () => {
    if (choosesLoanType) setChooseType(true)
    else start()
  }
  return (
    <>
      <Panel
        title="Latest applications"
        action={
          <Button size="sm" onClick={begin}>
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
                      {money(row.amount)} {(row.productName || LOAN_TYPE_LABELS[row.loanType]).toLowerCase()}, {timeAgo(row.submittedAt)}
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
      {choosesLoanType ? (
        <AssistedApplicationTypeDialog open={chooseType} onOpenChange={setChooseType} onChoose={start} />
      ) : null}
    </>
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
    const roles = registeredRoles()
    const byRole = Object.fromEntries(roles.map((role) => [role.key, { active: 0, invited: 0, disabled: 0 }]))
    overview.userCounts.forEach(({ role, status, count }) => {
      if (byRole[role]) byRole[role][status] = count
    })
    // Built-in roles always show; a custom role once someone holds it.
    const rows = roles
      .map((role) => ({ role: role.key, builtIn: role.builtIn, ...byRole[role.key], total: byRole[role.key].active + byRole[role.key].invited }))
      .filter((row) => row.builtIn || row.total)
    return { rows, total: rows.reduce((sum, row) => sum + row.total, 0), invited: rows.reduce((sum, row) => sum + row.invited, 0) }
  }, [overview.userCounts])
  const lmsEntries = Object.entries(lmsHealth || {})

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
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
              style={{ width: `${(row.total / team.total) * 100}%`, background: roleTone(row.role).bar }}
              title={`${roleLabel(row.role)}: ${row.total}`}
            />
          ))}
      </div>
      <dl className="mt-5 grid gap-y-3">
        {team.rows.map((row) => (
          <div key={row.role} className="flex items-center justify-between gap-3 border-b border-dashed pb-2">
            <dt className="flex items-center gap-2 text-sm text-foreground">
              <span className={cn('size-2 rounded-full', roleTone(row.role).dot)} aria-hidden="true" />
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
