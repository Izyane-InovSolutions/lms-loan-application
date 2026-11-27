import React, { useEffect, useState } from 'react'
import { BadgeCheck, CheckCircle2, CircleSlash, Clock, Handshake, Loader2, Lock, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { OverLimitNotice } from '@/components/OverLimitNotice'
import { PRE_APPROVAL_STAGES } from '@/config/partners'
import { Field, FormError, dateTime, money } from '../components'

/**
 * A pre-approved partner loan on the case page (src/config/partners.js): where it is on the
 * route, the partner's answer and the staff-list match, and, for those who issue offers,
 * "Issue offer" and "Send to full review".
 */
export function PreApprovalPanel({ application, preApproval, canIssue, heldMessage = null, onIssue, onLeave }) {
  const [dialog, setDialog] = useState(null)
  if (!preApproval) return null
  const { stage, partnerName, mouReference, staffMatch, partnerDecision, issued, reason } = preApproval
  const onRoute = stage === 'prescreen' || stage === 'partner' || stage === 'issue'
  const tone = stage === 'review' ? 'border-border bg-muted/30' : 'border-primary/25 bg-primary/5'

  return (
    <section aria-labelledby="pre-approval-title" className={cn('rounded-lg border p-4', tone)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5 text-sm">
          <h2 id="pre-approval-title" className="flex items-center gap-2 font-semibold text-foreground">
            <Handshake className="size-4 text-primary" aria-hidden="true" />
            Pre-approved for {partnerName || 'a partner'}’s staff
            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">{PRE_APPROVAL_STAGES[stage]?.label || stage}</span>
          </h2>
          {mouReference ? <p className="text-muted-foreground">MoU {mouReference}</p> : null}
          {staffMatch ? (
            <p className={staffMatch.onList ? 'text-success' : 'text-warning'}>
              {staffMatch.onList ? `On the partner’s staff list${staffMatch.employeeNumber ? `, employee no. ${staffMatch.employeeNumber}` : ''}` : 'Not on the partner’s staff list'}
            </p>
          ) : null}
          {stage === 'partner' ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="size-4" aria-hidden="true" />
              Waiting for {partnerName} to confirm the applicant works there.
            </p>
          ) : null}
          {stage === 'partner' && preApproval.overLimit ? <OverLimitNotice text={preApproval.overLimit} className="mt-1" /> : null}
          {partnerDecision ? (
            <p className={cn('flex items-center gap-1.5', partnerDecision.confirmed ? 'text-success' : 'text-destructive')}>
              {partnerDecision.confirmed ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <CircleSlash className="size-4" aria-hidden="true" />}
              {partnerDecision.confirmed ? 'Employment confirmed' : 'Not confirmed'} by {partnerDecision.byName}, {dateTime(partnerDecision.at)}
              {partnerDecision.note ? `: ${partnerDecision.note}` : ''}
            </p>
          ) : null}
          {issued ? (
            <p className="flex items-center gap-1.5 text-success">
              <BadgeCheck className="size-4" aria-hidden="true" />
              Offer issued by {issued.byName}, {dateTime(issued.at)}
            </p>
          ) : null}
          {heldMessage ? (
            <p className="flex items-start gap-1.5 font-medium text-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {heldMessage}
            </p>
          ) : null}
          {stage === 'review' && reason ? (
            /\babove the pre-approved limit\b/.test(reason) ? <OverLimitNotice text={reason} className="mt-1" /> : <p className="text-muted-foreground">Goes through the usual review: {reason}</p>
          ) : null}
          {onRoute && canIssue && preApproval.issueBlocked && stage === 'issue' ? <p className="text-warning">{preApproval.issueBlocked}</p> : null}
        </div>
        {onRoute && canIssue ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('leave')}>
              Send to full review
            </Button>
            {stage === 'issue' ? (
              <Button size="sm" onClick={() => setDialog('issue')} disabled={Boolean(preApproval.issueBlocked)}>
                <Send />
                Issue offer
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <IssueDialog open={dialog === 'issue'} application={application} preApproval={preApproval} onClose={() => setDialog(null)} onIssue={onIssue} />
      <LeaveDialog open={dialog === 'leave'} onClose={() => setDialog(null)} onLeave={onLeave} />
    </section>
  )
}

function IssueDialog({ open, application, preApproval, onClose, onIssue }) {
  const [amount, setAmount] = useState(application.amount)
  const [tenure, setTenure] = useState(application.tenure)
  const [conditions, setConditions] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setAmount(application.amount)
    setTenure(application.tenure)
    setConditions('')
    setError('')
  }, [open, application])

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onIssue({ amount: Number(amount), tenure: Number(tenure), conditions })
      onClose()
    } catch (issueError) {
      setError(issueError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue the offer</DialogTitle>
          <DialogDescription>
            Pre-approved under the {preApproval.partnerName} MoU. The customer is sent the offer to accept straight away. Lower the amount or tenure if needed
            {preApproval.maxAmount ? `; the pre-approved limit is ${money(preApproval.maxAmount)}` : ''}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="issue-amount" label="Amount (K)">
              <Input id="issue-amount" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <Field id="issue-tenure" label="Tenure (months)">
              <Input id="issue-tenure" type="number" min="1" value={tenure} onChange={(event) => setTenure(event.target.value)} />
            </Field>
          </div>
          <Field id="issue-conditions" label="Conditions (optional)" hint="One per line. Each must be ticked off before payout.">
            <textarea
              id="issue-conditions"
              rows={3}
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Send />}
              Issue offer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LeaveDialog({ open, onClose, onLeave }) {
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setRationale('')
      setError('')
    }
  }, [open])

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onLeave({ rationale })
      onClose()
    } catch (leaveError) {
      setError(leaveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to full review</DialogTitle>
          <DialogDescription>The case leaves the pre-approval route and goes through appraisal, review and approval like any other.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field id="leave-rationale" label="Why?">
            <Input id="leave-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || rationale.trim().length < 3}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Send to full review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
