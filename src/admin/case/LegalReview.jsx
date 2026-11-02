import React, { useId, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, FileText, Loader2, Shield, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { collateralItems, describeTerms, itemLabel, lendingValue, pledgeTerms } from '@/config/collateral'
import { reviewableDocuments } from '@/config/legalReview'
import { FormError, Panel, money, timeAgo } from '../components'

/*
 * The case's legal review: each pledged collateral item and each document, and whether a
 * legal officer (legal.verify) has verified it or found an issue with it. Everyone on the
 * case sees where it stands; only those with the permission change it
 * (POST /applications/:id/verifications). A document replaced by a newer copy drops out:
 * the new copy is checked on its own.
 */

const STATUS = {
  verified: { label: 'Verified', icon: CheckCircle2, className: 'bg-success/15 text-success' },
  issue: { label: 'Issue found', icon: AlertTriangle, className: 'bg-destructive/10 text-destructive' },
  pending: { label: 'Not checked', icon: CircleDashed, className: 'bg-muted text-muted-foreground' },
}


export function LegalReview({ application, documents, collateralCatalog, canVerify, holdsApproval = false, onVerify, onOpenDocument }) {
  const checks = application.verifications || {}
  const items = collateralItems(application.data)
  const files = reviewableDocuments(documents)
  const all = [...items.map((_, index) => checks.collateral?.[index]), ...files.map((document) => checks.documents?.[document.id])]
  const verified = all.filter((check) => check?.status === 'verified').length
  const issues = all.filter((check) => check?.status === 'issue').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
          <Shield className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {verified} of {all.length} verified
            {issues ? <span className="text-destructive">, {issues} with an issue</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {canVerify ? 'Verify each collateral item and document, or record what is wrong with it.' : 'Checked by the legal officer. Issues they record show here and on the timeline.'}
            {holdsApproval ? ' The case can’t be approved until everything here is verified.' : ''}
          </p>
        </div>
      </div>

      <Panel title={`Collateral (${items.length})`} description="What the applicant pledged, with the value they stated and what can be lent against it.">
        {items.length ? (
          <ul className="divide-y rounded-lg border">
            {items.map((item, index) => {
              const proof = documents.find((document) => document.slot === `collateral.${index}` && !document.supersededBy)
              return (
                <ReviewRow key={index} check={checks.collateral?.[index]} canVerify={canVerify} onVerify={(status, note) => onVerify('collateral', index, status, note)}>
                  <p className="font-medium text-foreground">
                    {itemLabel(item, collateralCatalog)}
                    {item.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{item.code}</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{String(item.description || '').trim() || 'No description'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stated value {money(Number(item.value) || 0)} · lending value {money(lendingValue(item, collateralCatalog))} ({describeTerms(pledgeTerms(item, collateralCatalog))})
                  </p>
                  {proof ? (
                    <button type="button" onClick={() => onOpenDocument(proof.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <FileText className="size-3.5" aria-hidden="true" />
                      Open proof: {proof.filename}
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-warning">No proof of ownership or value attached.</p>
                  )}
                </ReviewRow>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No collateral was pledged on this application.</p>
        )}
      </Panel>

      <Panel title={`Documents (${files.length})`} description="What the applicant and staff uploaded. A newer copy of a document is checked on its own.">
        {files.length ? (
          <ul className="divide-y rounded-lg border">
            {files.map((document) => (
              <ReviewRow key={document.id} check={checks.documents?.[document.id]} canVerify={canVerify} onVerify={(status, note) => onVerify('document', document.id, status, note)}>
                <button type="button" onClick={() => onOpenDocument(document.id)} className="text-left font-medium text-foreground hover:text-primary hover:underline">
                  {document.label}
                </button>
                <p className="text-xs text-muted-foreground">
                  {document.filename} · added {timeAgo(document.createdAt)}
                  {document.source === 'staff' ? ' by staff' : document.source === 'info_response' ? ' after a request' : ''}
                </p>
              </ReviewRow>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents on this application.</p>
        )}
      </Panel>
    </div>
  )
}

/** One thing to check: what it is, where it stands, and (with legal.verify) the buttons. */
function ReviewRow({ check, canVerify, onVerify, children }) {
  const [raising, setRaising] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const noteId = useId()
  const status = STATUS[check?.status] || STATUS.pending
  const Icon = status.icon

  const send = async (next, text = '') => {
    setBusy(next)
    setError('')
    try {
      await onVerify(next, text)
      setRaising(false)
      setNote('')
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', status.className)}>
            <Icon className="size-3.5" aria-hidden="true" />
            {status.label}
          </span>
          {canVerify ? (
            <div className="flex gap-2">
              {check ? (
                <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => send('clear')}>
                  {busy === 'clear' ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Undo
                </Button>
              ) : null}
              {check?.status !== 'verified' ? (
                <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => send('verified')}>
                  {busy === 'verified' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Verify
                </Button>
              ) : null}
              {check?.status !== 'issue' && !raising ? (
                <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => setRaising(true)}>
                  <AlertTriangle />
                  Issue
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {check ? (
        <p className={cn('text-xs', check.status === 'issue' ? 'text-destructive' : 'text-muted-foreground')}>
          {check.status === 'issue' ? `${check.note} — ` : check.note ? `${check.note} — ` : ''}
          {check.byName || 'Someone'}, {timeAgo(check.at)}
        </p>
      ) : null}
      {raising ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            send('issue', note.trim())
          }}
        >
          <label className="sr-only" htmlFor={noteId}>
            What is wrong with it
          </label>
          <input
            id={noteId}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="What is wrong with it, e.g. the title deed is in another name"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRaising(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={busy === 'issue' || note.trim().length < 3}>
              {busy === 'issue' ? <Loader2 className="animate-spin" /> : null}
              Record issue
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  )
}
