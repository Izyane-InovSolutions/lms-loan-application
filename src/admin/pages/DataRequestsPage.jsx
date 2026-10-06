import React, { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, ChevronLeft, ChevronRight, Loader2, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LOAN_TYPE_LABELS, statusLabel } from '@/config/applications'
import { api, toQuery } from '../api'
import { EmptyState, ErrorState, Field, FormError, PageHeader, Panel, SkeletonRows, StatusBadge, dateTime, money, useToast } from '../components'

const DAY_MS = 24 * 60 * 60 * 1000
const STATUS_FILTERS = [
  ['active', 'Active'],
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
]
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected' }
const TYPE_LABELS = { access: 'Access', erasure: 'Erasure' }
const COUNT_LABELS = [
  ['applications', 'Applications'],
  ['documents', 'Documents'],
  ['consents', 'Consents'],
  ['locations', 'Location records'],
  ['crbReports', 'Credit reports'],
  ['draft', 'Unfinished draft'],
  ['account', 'Customer account'],
]
const selectClass = 'h-10 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Days left (or overdue) for an unfinished request. Closed requests show no countdown. */
export const dueLabel = (request, now = Date.now()) => {
  if (request.status === 'completed' || request.status === 'rejected') return null
  const days = Math.ceil((new Date(request.dueAt).getTime() - now) / DAY_MS)
  if (days < 0) return { overdue: true, text: `Overdue by ${-days} ${days === -1 ? 'day' : 'days'}` }
  if (days === 0) return { overdue: false, text: 'Due today' }
  return { overdue: false, text: `${days} ${days === 1 ? 'day' : 'days'} left` }
}

/** Saves a fetched response as a file, using the name the server gave it. */
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Ledger({ refreshKey, onChanged }) {
  const notify = useToast()
  const [status, setStatus] = useState('active')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('due')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const [logForm, setLogForm] = useState({ email: '', type: 'access' })
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ status: 'in_progress', outcome: '' })
  const [dialogError, setDialogError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setData(await api(`/admin/data-requests/ledger${toQuery({ status: status === 'all' ? undefined : status, type, sort, dir: 'asc', page })}`))
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }, [status, type, sort, page])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const submitLog = async (event) => {
    event.preventDefault()
    setSaving(true)
    setDialogError('')
    try {
      await api('/admin/data-requests/ledger', { method: 'POST', body: logForm })
      notify('Request logged. It is due in 30 days.')
      setLogOpen(false)
      setLogForm({ email: '', type: 'access' })
      await load()
      onChanged()
    } catch (error) {
      setDialogError(error.message)
    } finally {
      setSaving(false)
    }
  }

  const submitEdit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setDialogError('')
    try {
      await api(`/admin/data-requests/ledger/${editing.id}`, { method: 'PATCH', body: editForm })
      notify('Request updated')
      setEditing(null)
      await load()
      onChanged()
    } catch (error) {
      setDialogError(error.message)
    } finally {
      setSaving(false)
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Panel
      title="Request ledger"
      description="Each request has 30 days. Only a hash of the email is kept here, so the entry outlives an erasure."
      action={
        <Button
          size="sm"
          onClick={() => {
            setDialogError('')
            setLogOpen(true)
          }}
        >
          <Plus />
          Log a request
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={status === value ? 'default' : 'outline'}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value)
                setPage(1)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <select aria-label="Filter by type" className={`${selectClass} ml-auto h-9`} value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}>
          <option value="all">All types</option>
          <option value="access">Access</option>
          <option value="erasure">Erasure</option>
        </select>
        <select aria-label="Sort by" className={`${selectClass} h-9`} value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
          <option value="due">Soonest due</option>
          <option value="received">Oldest received</option>
        </select>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && !data ? (
          <SkeletonRows rows={3} className="p-5" />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : data.items.length ? (
          <ul className="divide-y">
            {data.items.map((request) => {
              const due = dueLabel(request)
              return (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{TYPE_LABELS[request.type]}</span>
                    <span className="ml-2 text-muted-foreground">received {dateTime(request.receivedAt)}, due {dateTime(request.dueAt)}</span>
                    {request.outcome ? <span className="mt-0.5 block text-xs text-muted-foreground">{request.outcome}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {due ? (
                      <span className={due.overdue ? 'rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>{due.text}</span>
                    ) : null}
                    <StatusBadge status={request.status} label={STATUS_LABELS[request.status]} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDialogError('')
                        setEditing(request)
                        setEditForm({ status: request.status === 'open' ? 'in_progress' : request.status, outcome: request.outcome || '' })
                      }}
                    >
                      Update
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState icon={Search} title="No requests here">
            Log a request when someone asks for a copy of their data or for it to be erased.
          </EmptyState>
        )}
      </div>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
          <span>
            Page {data.page} of {pages}, {data.total} requests
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </span>
        </div>
      ) : null}

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent>
          <form onSubmit={submitLog} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Log a request</DialogTitle>
              <DialogDescription>The email address is hashed and not stored. You will pick this entry again when you look the person up.</DialogDescription>
            </DialogHeader>
            <Field id="log-email" label="Their email address">
              <Input id="log-email" type="email" value={logForm.email} onChange={(event) => setLogForm({ ...logForm, email: event.target.value })} />
            </Field>
            <Field id="log-type" label="What they asked for">
              <select id="log-type" className={`${selectClass} w-full`} value={logForm.type} onChange={(event) => setLogForm({ ...logForm, type: event.target.value })}>
                <option value="access">A copy of their data</option>
                <option value="erasure">Erasure</option>
              </select>
            </Field>
            <FormError message={dialogError} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!logForm.email.trim() || saving}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                Log request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <form onSubmit={submitEdit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Update {editing ? TYPE_LABELS[editing.type].toLowerCase() : ''} request</DialogTitle>
              <DialogDescription>Changes are audited.</DialogDescription>
            </DialogHeader>
            <Field id="edit-status" label="Status">
              <select id="edit-status" className={`${selectClass} w-full`} value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="edit-outcome" label="Outcome note" hint={editForm.status === 'rejected' ? 'Required: say why it was rejected.' : 'Optional.'}>
              <Input id="edit-outcome" value={editForm.outcome} onChange={(event) => setEditForm({ ...editForm, outcome: event.target.value })} />
            </Field>
            <FormError message={dialogError} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/**
 * Requests from one person under the Data Protection Act: what we hold about them, a
 * copy of it, or erasure. Loan records that must be kept block erasure. Work can be
 * linked to an entry in the request ledger.
 */
export function DataRequestsPage() {
  const notify = useToast()
  const [email, setEmail] = useState('')
  const [requestId, setRequestId] = useState('')
  const [linkable, setLinkable] = useState([])
  const [ledgerKey, setLedgerKey] = useState(0)
  const [result, setResult] = useState(null)
  const [pageError, setPageError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    api(`/admin/data-requests/ledger${toQuery({ status: 'active', pageSize: 100 })}`)
      .then((data) => setLinkable(data.items))
      .catch(() => setLinkable([]))
  }, [ledgerKey])

  const withLink = (path, params = {}) => `${path}${toQuery({ ...params, requestId: requestId || undefined })}`

  const search = async (event) => {
    event?.preventDefault()
    setBusy('search')
    setPageError('')
    setResult(null)
    try {
      setResult(await api(withLink('/admin/data-requests', { email: email.trim() })))
      setLedgerKey((key) => key + 1)
    } catch (searchError) {
      setPageError(searchError.message)
    } finally {
      setBusy(null)
    }
  }

  const download = async () => {
    setBusy('export')
    try {
      const response = await fetch(`/api/v1${withLink('/admin/data-requests/export', { email: result.email })}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message || 'The export failed. Please try again.')
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'personal-data.json'
      saveBlob(await response.blob(), name)
      notify('Download started')
      setLedgerKey((key) => key + 1)
    } catch (exportError) {
      notify(exportError.message || 'We couldn’t reach the server. Check your connection and try again.', { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const openConfirm = async () => {
    setConfirm('')
    setDialogError('')
    setPreview(null)
    setPreviewError('')
    setConfirmOpen(true)
    try {
      setPreview(await api(`/admin/data-requests/preview?email=${encodeURIComponent(result.email)}`))
    } catch (error) {
      setPreviewError(error.message)
    }
  }

  const erase = async () => {
    setBusy('erase')
    setDialogError('')
    try {
      const { erased } = await api('/admin/data-requests/erase', { method: 'POST', body: { email: result.email, confirm, requestId: requestId || undefined } })
      notify(`Erased ${erased.applications} ${erased.applications === 1 ? 'application' : 'applications'}${erased.account ? ' and the account' : ''}`)
      setConfirmOpen(false)
      setConfirm('')
      await search()
    } catch (eraseError) {
      setDialogError(eraseError.message)
    } finally {
      setBusy(null)
    }
  }

  const nothingHeld = result && !result.account && !result.applications.length && !result.hasDraft

  return (
    <div className="space-y-6">
      <PageHeader title="Data requests" description="When someone asks for a copy of their data, or for it to be deleted. Every search, export and erasure is audited." />

      <Ledger refreshKey={ledgerKey} onChanged={() => setLedgerKey((key) => key + 1)} />

      <form onSubmit={search} className="flex max-w-3xl flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="email" aria-label="Their email address" placeholder="Their email address" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 pl-9 text-sm" />
        </div>
        <select aria-label="Link to a ledger entry" className={`${selectClass} max-w-64`} value={requestId} onChange={(event) => setRequestId(event.target.value)}>
          <option value="">Not linked to a request</option>
          {linkable.map((request) => (
            <option key={request.id} value={request.id}>
              {TYPE_LABELS[request.type]}, received {dateTime(request.receivedAt)}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={!email.trim() || busy === 'search'}>
          {busy === 'search' ? <Loader2 className="animate-spin" /> : null}
          Find
        </Button>
      </form>
      <div aria-live="polite">
        <FormError message={pageError} />
      </div>

      <div aria-live="polite">
        {nothingHeld ? (
          <div className="rounded-xl border bg-card">
            <EmptyState icon={Search} title="Nothing held for this address">
              No account, applications or unfinished draft.
            </EmptyState>
          </div>
        ) : result ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title={result.email} description={result.account ? `Customer account since ${dateTime(result.account.createdAt)}` : 'No customer account'} bodyClassName="p-0">
              {result.applications.length ? (
                <ul className="divide-y">
                  {result.applications.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span>
                        <a href={`/admin/applications/${row.id}`} className="font-medium text-primary hover:underline">
                          {row.reference}
                        </a>
                        <span className="ml-2 text-muted-foreground">
                          {money(row.amount)} {LOAN_TYPE_LABELS[row.loanType].toLowerCase()}, {dateTime(row.submittedAt)}
                        </span>
                      </span>
                      <StatusBadge status={row.status} label={statusLabel(row.status)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-sm text-muted-foreground">No submitted applications.</p>
              )}
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                {result.documents} {result.documents === 1 ? 'document' : 'documents'}
                {result.hasDraft ? ', plus an unfinished draft' : ''}
              </p>
            </Panel>
            <div className="space-y-4">
              <Panel title="A copy of their data">
                <p className="text-sm text-muted-foreground">Every application, consent, location and timeline entry they can see, as one file. Documents can be downloaded from each case.</p>
                <Button variant="outline" className="mt-4" onClick={download} disabled={busy === 'export'}>
                  {busy === 'export' ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
                  Download their data
                </Button>
              </Panel>
              <Panel title="Erase">
                {result.canErase ? (
                  <>
                    <p className="text-sm text-muted-foreground">Deletes their applications, documents, draft and account. The audit trail keeps what happened, without their name.</p>
                    <Button variant="destructive" className="mt-4" onClick={openConfirm}>
                      <Trash2 />
                      Erase their data
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                      Can’t be erased yet. These are loan records the lender must keep:
                    </p>
                    <ul className="space-y-2">
                      {(result.keptDetails || []).map((item) => (
                        <li key={item.reference} className="rounded-md bg-muted px-3 py-2">
                          <span className="font-medium text-foreground">{item.reference}</span> ({statusLabel(item.status)}). {item.reason}
                          {item.keptUntil ? ` Due for removal on ${dateTime(item.keptUntil)}.` : ''}
                        </li>
                      ))}
                    </ul>
                    <p>Retention periods are set under Settings, Data retention. Once a record is removed, the rest can be erased.</p>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase everything held about {result?.email}?</DialogTitle>
            <DialogDescription>This can’t be undone. Here is what will be removed.</DialogDescription>
          </DialogHeader>
          <div aria-live="polite">
            {preview ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm">
                {COUNT_LABELS.map(([key, label]) => (
                  <React.Fragment key={key}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium tabular-nums">{preview.counts[key]}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : previewError ? (
              <FormError message={previewError} />
            ) : (
              <SkeletonRows rows={3} />
            )}
          </div>
          <Field id="erase-confirm" label="Type the email address to confirm">
            <Input id="erase-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <div aria-live="polite">
            <FormError message={dialogError} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={erase} disabled={confirm.trim().toLowerCase() !== result?.email || busy === 'erase' || !preview}>
              {busy === 'erase' ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Erase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
