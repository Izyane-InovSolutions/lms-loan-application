import React, { useId, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Eye, FileText, Loader2, MessageSquare, Pencil, Ruler, Shield, Undo2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { appraisedItems, collateralItems, describeTerms, itemLabel, lendingValue, pledgeTerms } from '@/config/collateral'
import { proofsOfItem, reviewableDocuments } from '@/config/legalReview'
import { FormError, Panel, money, timeAgo } from '../components'

/*
 * The case's Collateral tab: each pledged item, at the two stages that look at it.
 *   Appraisal     its valuation — the lender's valuer, market and forced-sale values,
 *                 inspection, report (cases.work, PUT …/valuations/:index) — from which its
 *                 lending value is worked out. The case leaves Appraisal once every item is valued.
 *   Underwriting  the legal officer's check (legal.verify) of the item and each proof file the
 *                 applicant attached: verified, or an issue recorded; with comments from them and
 *                 the officers. A secured loan isn't approved until it is done.
 * The applicant's other documents are underwriting's to check, on the Documents tab. A loan
 * with no collateral has nothing here: it skips Appraisal, and has no legal check.
 * Every file opens in a preview here. A proof replaced by a newer copy drops out: the new copy
 * is checked on its own.
 */

const STATUS = {
  verified: { label: 'Verified', icon: CheckCircle2, className: 'bg-success/15 text-success' },
  issue: { label: 'Issue found', icon: AlertTriangle, className: 'bg-destructive/10 text-destructive' },
  pending: { label: 'Not checked', icon: CircleDashed, className: 'bg-muted text-muted-foreground' },
}


export function LegalReview({ application, documents, collateralCatalog, canVerify, canComment, canValue = false, holdsApproval = false, onVerify, onComment, onValue, onUploadReport }) {
  const [viewing, setViewing] = useState(null)
  const valuations = application.valuations || {}
  const appraised = appraisedItems(application.data, valuations)
  const valuedCount = appraised.filter((item) => item.valued).length
  const checks = application.verifications || {}
  const comments = checks.comments || {}
  const items = collateralItems(application.data)
  const files = reviewableDocuments(documents)
  const all = [...items.map((_, index) => checks.collateral?.[index]), ...files.map((document) => checks.documents?.[document.id])]
  const verified = all.filter((check) => check?.status === 'verified').length
  const issues = all.filter((check) => check?.status === 'issue').length

  const documentRow = (document, { nested = false } = {}) => (
    <ReviewRow
      key={document.id}
      nested={nested}
      check={checks.documents?.[document.id]}
      comments={comments[`document:${document.id}`] || []}
      canVerify={canVerify}
      canComment={canComment}
      onVerify={(status, note) => onVerify('document', document.id, status, note)}
      onComment={(text) => onComment('document', document.id, text)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {document.label}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setViewing(document)}>
          <Eye />
          View document
        </Button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {document.filename} · added {timeAgo(document.createdAt)}
        {document.source === 'staff' ? ' by staff' : document.source === 'info_response' ? ' after a request' : ''}
      </p>
    </ReviewRow>
  )

  if (!items.length) {
    return (
      <Panel title="No collateral" description="This is an unsecured loan.">
        <p className="text-sm text-muted-foreground">
          Nothing was pledged, so there is nothing to value or for the legal officer to check: the case skips Appraisal and goes from Pre-screening straight to Underwriting. Its documents are checked
          in underwriting, on the Documents tab.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
          <Shield className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Appraisal: {valuedCount} of {items.length} valued · Legal check: {verified} of {all.length} verified
            {issues ? <span className="text-destructive">, {issues} with an issue</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {canValue ? 'Record each item’s valuation: the case leaves Appraisal once every item is valued. ' : ''}
            {canVerify ? 'Open each proof with “View document”, then verify the item and its files, or record what is wrong. ' : ''}
            {holdsApproval ? 'The loan can’t be approved until the legal check is done.' : ''}
          </p>
        </div>
      </div>

      <Panel title={`Collateral (${items.length})`} description="What the applicant pledged: its valuation, what can be lent against it on that value, and the legal check of it and every proof file attached.">
        {items.length ? (
          <ul className="divide-y rounded-lg border">
            {items.map((item, index) => {
              const proofs = proofsOfItem(documents, index)
              const valuation = valuations[index]
              const report = valuation?.reportId ? documents.find((document) => document.id === valuation.reportId) : null
              return (
                <ReviewRow
                  key={index}
                  check={checks.collateral?.[index]}
                  comments={comments[`collateral:${index}`] || []}
                  canVerify={canVerify}
                  canComment={canComment}
                  onVerify={(status, note) => onVerify('collateral', index, status, note)}
                  onComment={(text) => onComment('collateral', index, text)}
                  footer={
                    <>
                      <Valuation
                        valuation={valuation}
                        stated={Number(item.value) || 0}
                        report={report}
                        canValue={canValue}
                        onSave={(values) => onValue(index, values)}
                        onUpload={(file) => onUploadReport(index, file)}
                        onView={setViewing}
                      />
                      {proofs.length ? (
                        <ul className="mt-1 divide-y rounded-md border bg-muted/20">
                          {proofs.map((document) => documentRow(document, { nested: true }))}
                        </ul>
                      ) : (
                        <p className="text-xs text-warning">No proof of ownership or value attached.</p>
                      )}
                    </>
                  }
                >
                  <p className="font-medium text-foreground">
                    {itemLabel(item, collateralCatalog)}
                    {item.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{item.code}</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{String(item.description || '').trim() || 'No description'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {appraised[index].valued ? `Valued at ${money(appraised[index].value)}` : `Applicant’s estimate ${money(Number(item.value) || 0)}`} · lending value{' '}
                    {money(lendingValue(appraised[index], collateralCatalog))} ({describeTerms(pledgeTerms(item, collateralCatalog))}) · {proofs.length} {proofs.length === 1 ? 'proof file' : 'proof files'}
                  </p>
                </ReviewRow>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No collateral was pledged on this application.</p>
        )}
      </Panel>

      <DocumentPreview applicationId={application.id} document={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const blankValuation = (valuation) => ({
  valuer: valuation?.valuer || '',
  valuedOn: valuation?.valuedOn || today(),
  marketValue: valuation?.marketValue ?? '',
  forcedSaleValue: valuation?.forcedSaleValue ?? '',
  inspectedOn: valuation?.inspectedOn || '',
  notes: valuation?.notes || '',
})

/**
 * One collateral item's valuation: what the valuer found against what the applicant
 * estimated, the inspection, and the report — or a way to record them (cases.work).
 */
function Valuation({ valuation, stated, report, canValue, onSave, onUpload, onView }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState(() => blankValuation(valuation))
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const fileId = useId()
  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))
  const valued = Number(valuation?.marketValue) > 0

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      return true
    } catch (runError) {
      setError(runError.message)
      return false
    } finally {
      setBusy(null)
    }
  }
  const save = async (event) => {
    event.preventDefault()
    if (await run('save', () => onSave(values))) setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-3 rounded-md border bg-background p-3">
        <p className="text-sm font-medium text-foreground">{valued ? 'Edit the valuation' : 'Record the valuation'}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Valuer or firm
            <Input value={values.valuer} onChange={set('valuer')} className="h-9 text-sm" placeholder="e.g. Knight Frank Zambia" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Valued on
            <Input type="date" value={values.valuedOn} max={today()} onChange={set('valuedOn')} className="h-9 text-sm" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Inspected on (optional)
            <Input type="date" value={values.inspectedOn} max={today()} onChange={set('inspectedOn')} className="h-9 text-sm" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Market value (K)
            <Input inputMode="numeric" value={values.marketValue} onChange={set('marketValue')} className="h-9 text-sm" placeholder={stated ? String(stated) : ''} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Forced-sale value (K, optional)
            <Input inputMode="numeric" value={values.forcedSaleValue} onChange={set('forcedSaleValue')} className="h-9 text-sm" />
          </label>
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Notes (condition, ownership, encumbrances)
          <textarea
            rows={2}
            value={values.notes}
            onChange={set('notes')}
            maxLength={1000}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="animate-spin" /> : null}
            Save valuation
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
            {valued ? `Valued at ${money(valuation.marketValue)}` : 'Not valued yet'}
            {valued && stated ? (
              <span className={cn('text-xs font-normal', valuation.marketValue < stated ? 'text-warning' : 'text-muted-foreground')}>
                (the applicant estimated {money(stated)})
              </span>
            ) : null}
          </p>
          {valued ? (
            <p className="text-xs text-muted-foreground">
              By {valuation.valuer} on {valuation.valuedOn}
              {valuation.forcedSaleValue ? ` · forced-sale value ${money(valuation.forcedSaleValue)}` : ''}
              {valuation.inspectedOn ? ` · inspected ${valuation.inspectedOn}` : ' · not inspected'}
              {valuation.byName ? ` · recorded by ${valuation.byName}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Until it is, its lending value rests on the applicant’s own estimate.</p>
          )}
          {valuation?.notes ? <p className="mt-1 text-xs text-foreground [overflow-wrap:anywhere]">{valuation.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {report ? (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onView(report)}>
              <Eye />
              View report
            </Button>
          ) : null}
          {canValue ? (
            <>
              <label
                htmlFor={fileId}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring"
              >
                {busy === 'upload' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
                {report ? 'Replace report' : 'Upload report'}
                <input
                  id={fileId}
                  type="file"
                  accept="application/pdf,image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) run('upload', () => onUpload(file))
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant={valued ? 'ghost' : 'default'}
                className="h-8"
                onClick={() => {
                  setValues(blankValuation(valuation))
                  setEditing(true)
                }}
              >
                <Pencil />
                {valued ? 'Edit valuation' : 'Record valuation'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <FormError message={error} />
    </div>
  )
}

/** A document on the case, shown in place: a PDF in a frame, a photo as an image. */
function DocumentPreview({ applicationId, document, onClose }) {
  const src = document ? `/api/v1/applications/${applicationId}/documents/${document.id}` : null
  const isImage = document?.contentType?.startsWith('image/')
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{document?.label}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3">
            <span className="truncate">{document?.filename}</span>
            {src ? (
              <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Open in a new tab
              </a>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {src ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
            {isImage ? <img src={src} alt={document.label} className="mx-auto max-h-full object-contain" /> : <iframe src={src} title={document.label} className="h-full w-full" />}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** One thing to check: what it is, where it stands, its comments, and (with legal.verify) the buttons. */
function ReviewRow({ check, comments, canVerify, canComment, onVerify, onComment, nested = false, footer = null, children }) {
  const [raising, setRaising] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const noteId = useId()
  const commentId = useId()
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

  const postComment = async (event) => {
    event.preventDefault()
    setBusy('comment')
    setError('')
    try {
      await onComment(comment.trim())
      setComment('')
      setCommenting(false)
    } catch (commentError) {
      setError(commentError.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className={cn('space-y-2', nested ? 'p-3' : 'p-4')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', status.className)}>
            <Icon className="size-3.5" aria-hidden="true" />
            {status.label}
          </span>
          {canVerify ? (
            <div className="flex flex-wrap gap-2">
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
          {check.note ? `${check.note} — ` : ''}
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

      {comments.length || canComment ? (
        <div className="space-y-1.5 border-l-2 border-border pl-3">
          {comments.map((entry) => (
            <div key={entry.id} className="text-sm">
              <p className="text-foreground [overflow-wrap:anywhere]">{entry.text}</p>
              <p className="text-xs text-muted-foreground">
                {entry.byName || 'Someone'}, {timeAgo(entry.at)}
              </p>
            </div>
          ))}
          {canComment ? (
            commenting ? (
              <form className="flex flex-col gap-2 sm:flex-row" onSubmit={postComment}>
                <label className="sr-only" htmlFor={commentId}>
                  Comment
                </label>
                <textarea
                  id={commentId}
                  autoFocus
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={1000}
                  placeholder="What you saw, or what is still needed"
                  className="min-h-[2.25rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-2 sm:self-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCommenting(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy === 'comment' || comment.trim().length < 2}>
                    {busy === 'comment' ? <Loader2 className="animate-spin" /> : null}
                    Comment
                  </Button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setCommenting(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                {comments.length ? 'Reply' : 'Add a comment'}
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {footer}
      <FormError message={error} />
    </li>
  )
}
