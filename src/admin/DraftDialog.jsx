import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Loader2, PlayCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LOAN_TYPE_LABELS, channelLabel } from '@/config/applications'
import { applyPath } from '@/config/applicationSteps'
import { hasPermission } from '@/config/roles'
import { setAssistedFlag } from '@/lib/assisted'
import { hydrateDraftFiles } from '@/services/draftApi'
import { api } from './api'
import { useAuth } from './auth'
import { FormError, dateTime, money, timeAgo, useToast } from './components'
import { sectionsFor } from './case/fields'

/**
 * An unfinished application, opened from the pipeline: who it is and how to reach them,
 * how far they got, and what they entered — enough for a follow-up call. Staff who fill in
 * applications can continue it with the customer; anyone who sees it can send a reminder.
 */
export function DraftDialog({ draftId, onOpenChange, onChanged }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const notify = useToast()
  const [state, setState] = useState({ status: 'loading' })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!draftId) return
    setState({ status: 'loading' })
    setError('')
    api(`/drafts/${draftId}`)
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((loadError) => setState({ status: 'error', message: loadError.message }))
  }, [draftId])

  const sections = useMemo(
    () => (state.status === 'ready' ? sectionsFor({ loanType: state.draft.loanType, data: state.data }).filter((section) => section.rows.some(([, value]) => value && typeof value !== 'object')) : []),
    [state]
  )

  const canContinue = hasPermission(user, 'applications.assist')

  const continueDraft = async () => {
    setBusy('continue')
    setError('')
    try {
      const { draftToken, draft } = await api(`/drafts/${draftId}/resume`, { method: 'POST' })
      const hydrated = await hydrateDraftFiles(draft, draftToken)
      setAssistedFlag()
      navigate(applyPath(draft.loanType, draft.currentStep || 0), { state: { resumedDraft: { ...hydrated, draftToken } } })
    } catch (continueError) {
      setError(continueError.message)
      setBusy(null)
    }
  }

  const remind = async () => {
    setBusy('remind')
    setError('')
    try {
      await api(`/drafts/${draftId}/remind`, { method: 'POST' })
      notify(`Reminder emailed to ${state.draft.email}`)
      onChanged?.()
      onOpenChange(false)
    } catch (remindError) {
      setError(remindError.message)
    } finally {
      setBusy(null)
    }
  }

  const draft = state.draft

  return (
    <Dialog open={Boolean(draftId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {state.status === 'loading' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Opening the draft…
          </p>
        ) : state.status === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>Draft</DialogTitle>
            </DialogHeader>
            <FormError message={state.message} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{draft.companyName || draft.applicantName || draft.email}</DialogTitle>
              <DialogDescription>
                Unfinished {LOAN_TYPE_LABELS[draft.loanType].toLowerCase()}, saved {timeAgo(draft.lastSavedAt)}. It is deleted {dateTime(draft.expiresAt)} unless
                it changes before then.
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Email" value={<a className="text-primary hover:underline" href={`mailto:${draft.email}`}>{draft.email}</a>} />
              <Fact label="Phone" value={draft.applicantPhone ? <a className="text-primary hover:underline" href={`tel:+260${draft.applicantPhone}`}>+260 {draft.applicantPhone}</a> : 'Not given yet'} />
              <Fact label="Asking for" value={draft.amount ? `${money(draft.amount)}${draft.tenure ? ` over ${draft.tenure} months` : ''}` : 'Not chosen yet'} />
              <Fact label="Progress" value={`Step ${draft.currentStep + 1} of ${draft.stepCount}${draft.nextStep ? `: ${draft.nextStep}` : ''}`} />
              <Fact label="Documents" value={state.documents.length ? state.documents.map((document) => document.filename).join(', ') : 'None yet'} />
              <Fact
                label="Started"
                value={draft.startedByStaff ? `By ${draft.sourcedByName || 'staff'} with the customer` : draft.sourcedByName ? `Online, referred by ${draft.sourcedByName}` : `Online (${channelLabel(draft.channel).toLowerCase()})`}
              />
              <Fact
                label="Contact"
                value={draft.contactConsentAt ? `Agreed to be contacted, ${dateTime(draft.contactConsentAt)}` : 'Started by staff with the customer'}
              />
              {draft.remindedAt ? <Fact label="Last reminder" value={timeAgo(draft.remindedAt)} /> : null}
            </dl>

            {sections.length ? (
              <div className="space-y-3">
                {sections.map((section) => (
                  <section key={section.title} className="rounded-lg border p-4">
                    <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                    <dl className="mt-2 space-y-1.5">
                      {section.rows
                        .filter(([, value]) => value && typeof value !== 'object')
                        .map(([label, value]) => (
                          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="text-foreground [overflow-wrap:anywhere]">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </section>
                ))}
              </div>
            ) : null}

            <FormError message={error} />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={remind} disabled={Boolean(busy)}>
                {busy === 'remind' ? <Loader2 className="animate-spin" /> : <BellRing />}
                Email a reminder
              </Button>
              {canContinue ? (
                <Button onClick={continueDraft} disabled={Boolean(busy)}>
                  {busy === 'continue' ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                  Continue with the customer
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}
