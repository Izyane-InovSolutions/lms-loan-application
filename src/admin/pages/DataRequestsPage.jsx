import React, { useState } from 'react'
import { ArrowDownToLine, Loader2, Search, ShieldAlert, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LOAN_TYPE_LABELS, statusLabel } from '@/config/applications'
import { api } from '../api'
import { EmptyState, Field, FormError, PageHeader, Panel, StatusBadge, dateTime, money, useToast } from '../components'

/**
 * Requests from one person under the Data Protection Act: what we hold about them, a
 * copy of it, or erasure. Loan records that must be kept block erasure.
 */
export function DataRequestsPage() {
  const notify = useToast()
  const [email, setEmail] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirm, setConfirm] = useState('')

  const search = async (event) => {
    event?.preventDefault()
    setBusy('search')
    setError('')
    setResult(null)
    try {
      setResult(await api(`/admin/data-requests?email=${encodeURIComponent(email.trim())}`))
    } catch (searchError) {
      setError(searchError.message)
    } finally {
      setBusy(null)
    }
  }

  const erase = async () => {
    setBusy('erase')
    setError('')
    try {
      const { erased } = await api('/admin/data-requests/erase', { method: 'POST', body: { email: result.email, confirm } })
      notify(`Erased ${erased.applications} ${erased.applications === 1 ? 'application' : 'applications'}${erased.account ? ' and the account' : ''}`)
      setConfirmOpen(false)
      setConfirm('')
      await search()
    } catch (eraseError) {
      setError(eraseError.message)
    } finally {
      setBusy(null)
    }
  }

  const nothingHeld = result && !result.account && !result.applications.length && !result.hasDraft

  return (
    <div className="space-y-6">
      <PageHeader title="Data requests" description="When someone asks for a copy of their data, or for it to be deleted. Every search, export and erasure is audited." />
      <form onSubmit={search} className="flex max-w-xl gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="email" aria-label="Their email address" placeholder="Their email address" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 pl-9 text-sm" />
        </div>
        <Button type="submit" disabled={!email.trim() || busy === 'search'}>
          {busy === 'search' ? <Loader2 className="animate-spin" /> : null}
          Find
        </Button>
      </form>
      <FormError message={error} />

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
              <Button asChild variant="outline" className="mt-4">
                <a href={`/api/v1/admin/data-requests/export?email=${encodeURIComponent(result.email)}`}>
                  <ArrowDownToLine />
                  Download their data
                </a>
              </Button>
            </Panel>
            <Panel title="Erase">
              {result.canErase ? (
                <>
                  <p className="text-sm text-muted-foreground">Deletes their applications, documents, draft and account. The audit trail keeps what happened, without their name.</p>
                  <Button variant="destructive" className="mt-4" onClick={() => setConfirmOpen(true)}>
                    <Trash2 />
                    Erase their data
                  </Button>
                </>
              ) : (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  Can’t be erased while {result.blockedBy.join(', ')} {result.blockedBy.length === 1 ? 'is a loan record' : 'are loan records'}, which must be kept. Closed applications are removed by the retention periods in Settings.
                </p>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase everything held about {result?.email}?</DialogTitle>
            <DialogDescription>This can’t be undone.</DialogDescription>
          </DialogHeader>
          <Field id="erase-confirm" label="Type the email address to confirm">
            <Input id="erase-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={erase} disabled={confirm.trim().toLowerCase() !== result?.email || busy === 'erase'}>
              {busy === 'erase' ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Erase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
