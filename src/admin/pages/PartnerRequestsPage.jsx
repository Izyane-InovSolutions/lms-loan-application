import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, CircleSlash, Eye, FileText, Handshake, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { OverLimitNotice } from '@/components/OverLimitNotice'
import { api } from '../api'
import { EmptyState, ErrorState, Field, FormError, PageHeader, SkeletonRows, dateTime, money, useToast } from '../components'

const VIEWS = [
  { id: 'pending', label: 'Waiting for you' },
  { id: 'recent', label: 'Answered' },
]

/**
 * Partner requests: a partner's staff confirm, or refuse, that applicants for their
 * pre-approved loans work there (src/config/partners.js). While a request waits for them they
 * can review it: who the person is, what they said about their job, and their ID copy, photo
 * and payslips (PARTNER_DOCUMENT_SLOTS); never the rest of the application.
 */
export function PartnerRequestsPage() {
  const notify = useToast()
  const [view, setView] = useState('pending')
  const [state, setState] = useState({ status: 'loading', requests: [] })
  const [answering, setAnswering] = useState(null)
  const [reviewing, setReviewing] = useState(null)

  const load = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }))
    api(`/partner/requests?view=${view}`)
      .then((data) => setState({ status: 'ready', requests: data.requests }))
      .catch((error) => setState({ status: 'error', message: error.message, requests: [] }))
  }, [view])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <PageHeader title="Partner requests" description="People who applied for a loan pre-approved for your organisation’s staff. Confirm each one works for you, so their offer can be issued." />
      <nav aria-label="Requests" className="-mx-1 flex gap-1 border-b pb-px">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setView(entry.id)}
            aria-current={view === entry.id ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === entry.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {state.status === 'loading' ? (
        <SkeletonRows rows={4} />
      ) : state.status === 'error' ? (
        <ErrorState message={state.message} onRetry={load} />
      ) : !state.requests.length ? (
        <EmptyState icon={Handshake} title={view === 'pending' ? 'Nothing waiting' : 'Nothing answered yet'}>
          {view === 'pending' ? 'New requests appear here as your staff apply.' : 'Requests you confirm or refuse are listed here.'}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {state.requests.map((request) => (
            <li key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  {request.applicantName}
                  <span className="ml-2 font-normal text-muted-foreground">{request.passportNumber ? `Passport ${request.passportNumber}` : `NRC ${request.nrc || '—'}`}</span>
                </p>
                <p className="text-muted-foreground">
                  {money(request.amount)} over {request.tenure} months ({money(request.monthlyInstalment)} a month) · {request.reference} · applied {dateTime(request.submittedAt)}
                  {request.employerName ? ` · says they work at ${request.employerName}` : ''}
                </p>
                <OverLimitNotice text={request.overLimit} className="mt-1" />
                <StaffMatch match={request.staffMatch} />
                {request.partnerDecision ? (
                  <p className={cn('flex items-center gap-1.5', request.partnerDecision.confirmed ? 'text-success' : 'text-destructive')}>
                    {request.partnerDecision.confirmed ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <CircleSlash className="size-4" aria-hidden="true" />}
                    {request.partnerDecision.confirmed ? 'Confirmed' : 'Refused'} by {request.partnerDecision.byName}, {dateTime(request.partnerDecision.at)}
                    {request.partnerDecision.note ? `: ${request.partnerDecision.note}` : ''}
                  </p>
                ) : null}
              </div>
              {view === 'pending' ? (
                <Button size="sm" className="shrink-0" onClick={() => setReviewing(request.id)}>
                  <Eye />
                  Review
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ReviewDialog
        requestId={reviewing}
        onClose={() => setReviewing(null)}
        onAnswer={(request, decision) => {
          setReviewing(null)
          setAnswering({ request, decision })
        }}
        onGone={() => {
          setReviewing(null)
          load()
        }}
      />

      <AnswerDialog
        answering={answering}
        onClose={() => setAnswering(null)}
        onAnswered={(request) => {
          notify(request.partnerDecision?.confirmed ? `Confirmed ${request.applicantName}` : `Refused ${request.applicantName}`)
          setAnswering(null)
          load()
        }}
      />
    </div>
  )
}

const fullName = (applicant) => [applicant.firstName, applicant.middleName, applicant.surname].filter(Boolean).join(' ')
const sameName = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** A request in full: the person's details and documents to check against the partner's own records. */
function ReviewDialog({ requestId, onClose, onAnswer, onGone }) {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    if (!requestId) return undefined
    let live = true
    setState({ status: 'loading' })
    api(`/partner/requests/${requestId}`)
      .then((data) => live && setState({ status: 'ready', request: data.request }))
      .catch((error) => live && setState({ status: 'error', message: error.message, code: error.code }))
    return () => {
      live = false
    }
  }, [requestId])

  if (!requestId) return null
  const request = state.request
  const applicant = request?.applicant
  const listName = request?.staffMatch?.name
  const nameDiffers = applicant && listName && !sameName(listName, fullName(applicant)) && !sameName(listName, `${applicant.firstName} ${applicant.surname}`)

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request ? `Review ${request.applicantName}` : 'Review the request'}</DialogTitle>
          <DialogDescription>Check this person against your records: that they work for you, and that the details and documents below are theirs.</DialogDescription>
        </DialogHeader>

        {state.status === 'loading' ? (
          <SkeletonRows rows={4} />
        ) : state.status === 'error' ? (
          <div className="space-y-3">
            <FormError message={state.message} />
            {state.code === 'not_found' ? (
              <Button variant="outline" size="sm" onClick={onGone}>
                Back to the list
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <section aria-labelledby="review-details" className="space-y-2">
              <h3 id="review-details" className="font-medium text-foreground">
                What they told us
              </h3>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Detail label="Full name" value={fullName(applicant)} />
                {request.passportNumber ? <Detail label={`Passport (${applicant.nationality})`} value={request.passportNumber} /> : <Detail label="NRC" value={request.nrc} />}
                <Detail label="Date of birth" value={applicant.birthDate} />
                <Detail label="Phone" value={applicant.phone} />
                <Detail label="Occupation" value={applicant.occupation} />
                <Detail label="Employer they named" value={applicant.employerName} />
              </dl>
            </section>

            <section aria-labelledby="review-list" className="space-y-1 rounded-md border bg-muted/30 p-3">
              <h3 id="review-list" className="font-medium text-foreground">
                Your staff list
              </h3>
              {request.staffMatch?.onList ? (
                <p className="text-success">
                  On the list{listName ? ` as ${listName}` : ''}
                  {request.staffMatch.employeeNumber ? `, employee no. ${request.staffMatch.employeeNumber}` : ''}.
                </p>
              ) : (
                <p className="text-warning">{request.passportNumber ? 'They gave a passport, so they can’t be matched to your list by NRC: check them by name.' : 'Their NRC isn’t on the staff list you sent us: check your own records.'}</p>
              )}
              {nameDiffers ? (
                <p className="flex items-start gap-1.5 text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  The name on your list ({listName}) isn’t the name they gave. Make sure it’s the same person.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="review-loan" className="space-y-2">
              <h3 id="review-loan" className="font-medium text-foreground">
                What they applied for
              </h3>
              <p className="text-muted-foreground">
                {money(request.amount)} over {request.tenure} months ({money(request.monthlyInstalment)} a month) · {request.reference} · applied {dateTime(request.submittedAt)}
              </p>
              <OverLimitNotice text={request.overLimit} />
            </section>

            <section aria-labelledby="review-documents" className="space-y-2">
              <h3 id="review-documents" className="font-medium text-foreground">
                Their documents
              </h3>
              {request.documents.length ? (
                <ul className="divide-y rounded-md border">
                  {request.documents.map((document) => (
                    <li key={document.id}>
                      <a
                        href={`/api/v1/partner/requests/${request.id}/documents/${document.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium text-foreground">{document.label}</span>
                        <span className="truncate text-muted-foreground">{document.filename}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No ID copy, photo or payslips were uploaded.</p>
              )}
              <p className="text-xs text-muted-foreground">Each document you open is recorded.</p>
            </section>
          </div>
        )}

        {state.status === 'ready' ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onAnswer(request, 'refuse')}>
              <X />
              Doesn’t work here, or details don’t match
            </Button>
            <Button onClick={() => onAnswer(request, 'confirm')}>
              <Check />
              Confirm employment
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value || '—'}</dd>
    </div>
  )
}

function StaffMatch({ match }) {
  if (!match) return null
  return match.onList ? (
    <p className="text-success">On your staff list{match.employeeNumber ? `, employee no. ${match.employeeNumber}` : ''}</p>
  ) : (
    <p className="text-warning">Not on the staff list you sent us: please check before confirming.</p>
  )
}

function AnswerDialog({ answering, onClose, onAnswered }) {
  const [note, setNote] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNote('')
    setEmployeeNumber(answering?.request.staffMatch?.employeeNumber || '')
    setError('')
  }, [answering])

  if (!answering) return null
  const { request, decision } = answering
  const confirming = decision === 'confirm'

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await api(`/partner/requests/${request.id}`, { method: 'POST', body: { decision, note, employeeNumber, version: request.version } })
      onAnswered(response.request)
    } catch (answerError) {
      setError(answerError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirming ? `Confirm ${request.applicantName} works for you` : `You can’t confirm ${request.applicantName}`}</DialogTitle>
          <DialogDescription>
            {confirming
              ? `${request.overLimit ? 'Their application then goes through the lender’s usual review, as it is above the pre-approved limit.' : 'Their loan offer can then be issued.'} Confirm only someone currently employed by your organisation.`
              : 'Say what doesn’t match. Their application then goes through the lender’s usual review instead.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <OverLimitNotice text={request.overLimit} />
          {confirming ? (
            <Field id="answer-employee-number" label="Employee number (optional)">
              <Input id="answer-employee-number" value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value)} />
            </Field>
          ) : null}
          <Field id="answer-note" label={confirming ? 'Note (optional)' : 'Why not?'} hint={confirming ? '' : 'For example: left the organisation, on a short contract, or the payslips aren’t ours.'}>
            <Input id="answer-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (!confirming && note.trim().length < 3)} variant={confirming ? 'default' : 'destructive'}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {confirming ? 'Confirm employment' : 'Refuse'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
