import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ChevronLeft, ChevronRight, FilePlus2, FileStack, Loader2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { APPLICATION_STATUSES, CHANNELS, LOAN_TYPE_LABELS, OPEN_STATUSES, channelLabel, renamedStatus, statusLabel } from '@/config/applications'
import { hasPermission, registeredRoles } from '@/config/roles'
import { applyPath } from '@/config/applicationSteps'
import { setAssistedFlag } from '@/lib/assisted'
import { api, toQuery } from '../api'
import { useAuth } from '../auth'
import { EmptyState, FormError, OutcomeMark, PageHeader, StatusBadge, daysSince, downloadCsv, money, timeAgo, useToast } from '../components'
import { AssistedApplicationTypeDialog } from '../AssistedApplicationTypeDialog'

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'submitted', label: 'New' },
  { value: 'in_review', label: 'In review' },
  { value: 'info_requested', label: 'Waiting on applicant' },
  { value: 'pending_approval', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'disbursed', label: 'Paid out' },
  { value: 'declined', label: 'Declined' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
]

const DESCRIPTIONS = {
  admin: 'Every application in the workspace.',
  loan_officer: 'Every application. Take new ones from Open, and find yours under Assigned to me.',
  sales_manager: 'Every application: follow the team’s pipeline, bring customers in and work cases.',
  rm: 'Applications from your customers and the agents who report to you.',
  dsa: 'Applications you referred or filled in for customers.',
}

// For roles an admin added, by what their scope lets them see.
const SCOPE_DESCRIPTIONS = {
  all: 'Every application in the workspace.',
  team: 'Applications you and the people who report to you brought in or were assigned.',
  own: 'Applications you brought in or were assigned.',
}

// Open cases older than this get an ageing badge.
const AGEING_DAYS = 3

export function ApplicationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const notify = useToast()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') || '')
  const [result, setResult] = useState({ status: 'loading', applications: [], total: 0, statusCounts: {} })
  const [exporting, setExporting] = useState(false)
  const [chooseType, setChooseType] = useState(false)

  const filters = {
    status: params.get('status') || 'open',
    loanType: params.get('loanType') || 'all',
    channel: params.get('channel') || 'all',
    assigned: params.get('assigned') || 'all',
    sort: params.get('sort') || 'newest',
    q: params.get('q') || '',
    page: Number(params.get('page')) || 1,
  }
  const isOfficer = hasPermission(user, 'cases.work')
  const canStart = hasPermission(user, 'applications.assist')
  // Team leads (RMs, by default) may fill in business loans too; agents do personal loans.
  const choosesLoanType = canStart && hasPermission(user, 'team.lead')
  // Every role that brings business in is a channel.
  const channels = useMemo(
    () => ({ self: CHANNELS.self, ...Object.fromEntries(registeredRoles().filter((role) => role.permissions.includes('applications.assist')).map((role) => [role.key, role.label])) }),
    []
  )

  const setFilter = useCallback(
    (key, value) => {
      const next = new URLSearchParams(params)
      if (!value || value === 'all' || (key === 'status' && value === 'open')) next.delete(key)
      else next.set(key, value)
      if (key !== 'page') next.delete('page')
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

  const query = toQuery({ ...filters, status: filters.status === 'all' ? '' : filters.status, page: filters.page > 1 ? filters.page : '' })

  useEffect(() => {
    let cancelled = false
    setResult((prev) => ({ ...prev, status: prev.applications.length ? 'refreshing' : 'loading' }))
    api(`/applications${query}`)
      .then((data) => !cancelled && setResult({ status: 'ready', ...data }))
      .catch((error) => !cancelled && setResult({ status: 'error', applications: [], total: 0, statusCounts: {}, message: error.message }))
    return () => {
      cancelled = true
    }
  }, [query])

  const tabCount = (value) => {
    const counts = result.statusCounts || {}
    if (value === 'all') return Object.values(counts).reduce((sum, count) => sum + count, 0)
    if (value === 'open') return OPEN_STATUSES.reduce((sum, status) => sum + (counts[status] || 0), 0)
    return counts[value] || 0
  }

  const startAssisted = (loanType = 'personal') => {
    setAssistedFlag()
    navigate(applyPath(loanType, 0))
  }

  const beginAssisted = () => {
    if (choosesLoanType) setChooseType(true)
    else startAssisted()
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = []
      for (let page = 1; page <= 10; page += 1) {
        const data = await api(`/applications${toQuery({ ...filters, status: filters.status === 'all' ? '' : filters.status, page, pageSize: 200 })}`)
        rows.push(...data.applications)
        if (rows.length >= data.total) break
      }
      downloadCsv(`applications-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Reference', 'Applicant', 'Company', 'Product', 'Amount (ZMW)', 'Tenure (months)', 'Status', 'Rules', 'Channel', 'Brought in by', 'Officer', 'Submitted'],
        ...rows.map((row) => [
          row.reference,
          row.applicantName,
          row.companyName || '',
          LOAN_TYPE_LABELS[row.loanType],
          row.amount,
          row.tenure,
          statusLabel(row.status),
          row.prescreenOutcome || '',
          channelLabel(row.channel),
          row.sourcedByName || '',
          row.assignedOfficerName || '',
          new Date(row.submittedAt).toISOString(),
        ]),
      ])
      notify(`Exported ${rows.length} applications`)
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const pages = Math.max(1, Math.ceil(result.total / (result.pageSize || 25)))
  const hasFilters = filters.loanType !== 'all' || filters.channel !== 'all' || filters.assigned !== 'all' || filters.q

  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        description={DESCRIPTIONS[user.role] || SCOPE_DESCRIPTIONS[user.scope]}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={exporting || !result.total}>
              {exporting ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
              Export CSV
            </Button>
            {canStart ? (
              <Button onClick={beginAssisted}>
                <FilePlus2 />
                New application
              </Button>
            ) : null}
          </>
        }
      />

      <nav aria-label="Application status" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const active = filters.status === tab.value
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter('status', tab.value)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
              )}
            >
              {renamedStatus(tab.value) || tab.label}
              <span className={cn('rounded px-1.5 text-xs tabular-nums', active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{tabCount(tab.value)}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search applications"
            aria-label="Search applications"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-9 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="sm:w-40">
            <Select aria-label="Product" value={filters.loanType} onChange={(event) => setFilter('loanType', event.target.value)} className="h-10 text-sm">
              <option value="all">All products</option>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </Select>
          </div>
          <div className="sm:w-44">
            <Select aria-label="Channel" value={filters.channel} onChange={(event) => setFilter('channel', event.target.value)} className="h-10 text-sm">
              <option value="all">All channels</option>
              {Object.entries(channels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {isOfficer ? (
            <div className="sm:w-44">
              <Select aria-label="Assignment" value={filters.assigned} onChange={(event) => setFilter('assigned', event.target.value)} className="h-10 text-sm">
                <option value="all">Anyone’s</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </Select>
            </div>
          ) : null}
          <div className="sm:w-40">
            <Select aria-label="Sort" value={filters.sort} onChange={(event) => setFilter('sort', event.target.value)} className="h-10 text-sm">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount">Largest amount</option>
              <option value="updated">Recently updated</option>
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground lg:ml-auto" aria-live="polite">
          {result.status !== 'loading' ? `${result.total} ${result.total === 1 ? 'application' : 'applications'}` : null}
        </p>
      </div>

      <div className={cn('overflow-hidden rounded-xl border bg-card transition-opacity', result.status === 'refreshing' && 'opacity-70')}>
        {result.status === 'loading' ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading applications…
          </p>
        ) : result.status === 'error' ? (
          <div className="p-6">
            <FormError message={result.message} />
          </div>
        ) : result.applications.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={hasFilters ? 'Nothing matches these filters' : filters.status === 'open' ? 'No open applications' : `No ${statusLabel(filters.status).toLowerCase()} applications`}
            action={
              canStart ? (
                <Button size="sm" onClick={beginAssisted}>
                  <FilePlus2 />
                  New application
                </Button>
              ) : null
            }
          >
            {canStart ? 'Fill one in with a customer, or share your referral link from the dashboard.' : 'New submissions appear here as soon as they arrive.'}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {result.applications.map((row) => (
                <li key={row.id}>
                  <Link to={`/admin/applications/${row.id}`} className="block px-4 py-3.5 hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{row.companyName || row.applicantName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.reference}, {money(row.amount)} {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}
                        </p>
                      </div>
                      <StatusBadge status={row.status} label={statusLabel(row.status)} />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <OutcomeMark outcome={row.prescreenOutcome} />
                      <span className="text-xs text-muted-foreground">{timeAgo(row.submittedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-sm">
                <caption className="sr-only">Applications</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-medium">Applicant</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-4 py-3 font-medium">Brought in by</th>
                    <th scope="col" className="px-4 py-3 font-medium">Policy rules</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Officer</th>
                    <th scope="col" className="px-5 py-3 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.applications.map((row) => {
                    const age = daysSince(row.submittedAt)
                    const ageing = APPLICATION_STATUSES[row.status]?.open && age >= AGEING_DAYS
                    return (
                      <tr key={row.id} className="group cursor-pointer transition-colors hover:bg-muted/30" onClick={() => navigate(`/admin/applications/${row.id}`)}>
                        <td className="px-5 py-3">
                          <Link to={`/admin/applications/${row.id}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => event.stopPropagation()}>
                            <span className="block font-medium text-foreground group-hover:text-primary">{row.companyName || row.applicantName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {row.reference}
                              {row.companyName ? `, ${row.applicantName}` : ''}, {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="font-medium text-foreground">{money(row.amount)}</span>
                          <span className="block text-xs text-muted-foreground">{row.tenure} mo</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.sourcedByName || channelLabel(row.channel)}</td>
                        <td className="px-4 py-3">
                          <OutcomeMark outcome={row.prescreenOutcome} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} label={statusLabel(row.status)} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.assignedOfficerName || (APPLICATION_STATUSES[row.status]?.open ? 'Unassigned' : '—')}</td>
                        <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                          {timeAgo(row.submittedAt)}
                          {ageing ? <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">{age}d open</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {filters.page} of {pages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilter('page', String(filters.page - 1))}>
              <ChevronLeft />
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={filters.page >= pages} onClick={() => setFilter('page', String(filters.page + 1))}>
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
      {choosesLoanType ? (
        <AssistedApplicationTypeDialog
          open={chooseType}
          onOpenChange={setChooseType}
          onChoose={startAssisted}
        />
      ) : null}
    </div>
  )
}
