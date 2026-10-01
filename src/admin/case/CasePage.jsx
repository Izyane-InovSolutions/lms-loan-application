import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  ShieldAlert,
  Sparkles,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { LOAN_TYPE_LABELS, OPEN_STATUSES, WITHDRAWABLE_STATUSES, channelLabel, statusLabel } from '@/config/applications'
import { hasPermission, roleLabel } from '@/config/roles'
import { SignaturePad } from '@/components/application/SignaturePad'
import { findFormMismatches } from '@/utils/documentChecks'
import { api } from '../api'
import { useAuth } from '../auth'
import { FormError, StatusBadge, dateTime, money, timeAgo, useToast } from '../components'
import { ActionDialog } from './ActionDialog'
import {
  AffordabilityPanel,
  AiReviewPanel,
  AppraisalsPanel,
  ChecklistPanel,
  ConsentPanel,
  CrbPanel,
  LmsPanel,
  LocationPanel,
  RulesPanel,
  SignaturesPanel,
  StagesPanel,
} from './CasePanels'
import { sectionsFor } from './fields'

const withinAssignmentRange = (person, amount) =>
  Number(amount) >= (person.approvalMin ?? 0) && (person.approvalMax == null || Number(amount) <= person.approvalMax)
// A report younger than this is reused when a case is opened, as the Django adapter did.
const CRB_FRESH_HOURS = 24

export function CasePage() {
  const { id } = useParams()
  const { user } = useAuth()
  const notify = useToast()
  const [state, setState] = useState({ status: 'loading' })
  const [tab, setTab] = useState('details')
  const [dialog, setDialog] = useState(null)
  const [officers, setOfficers] = useState([])

  const load = useCallback(async () => {
    try {
      const data = await api(`/applications/${id}`)
      setState({ status: 'ready', ...data })
    } catch (error) {
      setState({ status: 'error', message: error.message, code: error.code })
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // The prescreen runs just after submit; poll briefly until it lands.
  useEffect(() => {
    if (state.status !== 'ready' || state.prescreen) return undefined
    const timer = setTimeout(load, 2500)
    return () => clearTimeout(timer)
  }, [state, load])

  // What this person's role lets them do here (Team → Roles); the server checks each again.
  const may = useMemo(
    () => ({
      work: hasPermission(user, 'cases.work'),
      assign: hasPermission(user, 'cases.assign'),
      recommend: hasPermission(user, 'cases.recommend'),
      decide: hasPermission(user, 'cases.decide'),
      disburse: hasPermission(user, 'cases.disburse'),
      record: hasPermission(user, 'offers.record'),
      note: hasPermission(user, 'applications.note'),
    }),
    [user]
  )
  useEffect(() => {
    if (!may.assign) return
    api('/officers').then(({ officers: list }) => setOfficers(list)).catch(() => {})
  }, [may.assign])

  /** Posts a workflow action against the version on screen; a stale screen is told to refresh. */
  const act = useCallback(
    async (action, payload = {}, message) => {
      try {
        const data = await api(`/applications/${id}/actions`, { method: 'POST', body: { action, version: state.application.version, ...payload } })
        setState({ status: 'ready', ...data })
        if (message) notify(message)
      } catch (error) {
        if (error.code === 'stale') load()
        throw error
      }
    },
    [id, state, notify, load]
  )

  const post = useCallback(
    async (path, body, message) => {
      const data = await api(`/applications/${id}${path}`, { method: 'POST', body })
      setState({ status: 'ready', ...data })
      if (message) notify(message)
    },
    [id, notify]
  )

  const [crbPull, setCrbPull] = useState({ status: 'idle' })
  const pullCrb = useCallback(
    async (message) => {
      setCrbPull({ status: 'pulling' })
      try {
        await post('/crb', {}, message)
        setCrbPull({ status: 'idle' })
      } catch (error) {
        // Another officer (or tab) is already pulling: show their report once it lands.
        if (error.code === 'crb_in_progress') {
          setCrbPull({ status: 'pulling' })
          setTimeout(() => load().finally(() => setCrbPull({ status: 'idle' })), 5000)
          return
        }
        setCrbPull({ status: 'error', message: error.message })
      }
    },
    [post, load]
  )

  // Opening a case pulls its credit report when credit staff open it, the applicant
  // consented, and there is no report from the last CRB_FRESH_HOURS. Each pull is a
  // billable enquiry, so it runs once per visit and never repeats a fresh report.
  const autoPulledFor = useRef(null)
  useEffect(() => {
    if (state.status !== 'ready' || !may.work || autoPulledFor.current === id) return
    autoPulledFor.current = id
    const consented = state.consents.some((consent) => consent.type === 'crb' && consent.granted)
    if (!state.crbProvider || !consented) return
    const latest = state.crbReports[0]
    const fresh = latest && Date.now() - new Date(latest.createdAt).getTime() < CRB_FRESH_HOURS * 3600000
    if (!fresh) pullCrb()
  }, [state, may.work, id, pullCrb])

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Opening the case…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <FormError message={state.code === 'not_found' ? 'This application doesn’t exist, or it isn’t one your role can see.' : state.message} />
      </div>
    )
  }

  const { application, documents, events, prescreen, appraisals, consents, locations, crbReports, lmsConfigured, crbProvider, offersRequireSignature, signatures, workflow } = state
  const eligibleOfficers = officers.filter((officer) => withinAssignmentRange(officer, application.amount))
  const canTake = withinAssignmentRange(user, application.amount)
  const lastRecommendation = appraisals.find((appraisal) => appraisal.kind === 'recommendation')
  const hasCrbConsent = consents.some((consent) => consent.type === 'crb' && consent.granted)
  const checklistEditable = may.work && (['submitted', 'in_review', 'info_requested'].includes(application.status) || workflow?.state.checks.length > 0)

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-col gap-4 border-b pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">{application.companyName || application.applicantName}</h1>
            <StatusBadge status={application.status} label={statusLabel(application.status)} />
            {workflow && workflow.state.label !== statusLabel(application.status) ? <span className="text-sm font-medium text-muted-foreground">{workflow.state.label}</span> : null}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {application.reference}, {LOAN_TYPE_LABELS[application.loanType].toLowerCase()}
            {application.companyName ? `, applicant ${application.applicantName}` : ''}, submitted {dateTime(application.submittedAt)}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label="Asked for" value={`${money(application.amount)} over ${application.tenure} months`} />
            {application.approvedAmount ? <Fact label="Approved" value={`${money(application.approvedAmount)} over ${application.approvedTenure} months`} /> : null}
            <Fact label="Monthly instalment" value={money(application.monthlyInstalment)} />
            <Fact label="Brought in by" value={application.sourcedByName ? `${application.sourcedByName} (${roleLabel(application.sourcedByRole).toLowerCase()})` : channelLabel(application.channel)} />
            <Fact label="Officer" value={application.assignedOfficerName || 'Unassigned'} />
            {application.status === 'approved' && application.offerExpiresAt ? (
              <Fact label="Offer" value={`Waiting for the customer, until ${dateTime(application.offerExpiresAt)}`} />
            ) : null}
            {application.acceptedAt ? <Fact label="Offer accepted" value={dateTime(application.acceptedAt)} /> : null}
          </dl>
        </div>
        <CaseActions
          application={application}
          workflow={workflow}
          may={may}
          canTake={canTake}
          hasEligibleOfficers={eligibleOfficers.length > 0}
          onOpen={setDialog}
          onClaim={(action) => act('transition', { actionId: action.id }, action.label === 'Start review' ? 'Review started' : `Moved to ${action.toLabel}`)}
          onTake={() => act('assign', { officerId: user.id }, 'The case is yours')}
          onTakeHere={() => act('take', {}, 'The case is yours at this stage')}
        />
      </header>

      {application.status === 'info_requested' && application.infoRequest ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">Waiting on the applicant: </span>
            <span className="text-muted-foreground">
              {application.infoRequest.message} (asked by {application.infoRequest.requestedBy}, {timeAgo(application.infoRequest.requestedAt)})
            </span>
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <nav className="flex gap-1 border-b" aria-label="Case sections">
            {[
              ['details', 'Details'],
              ['documents', `Documents (${documents.length})`],
              ['timeline', 'Timeline'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-current={tab === value ? 'page' : undefined}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'details' ? <Details application={application} /> : null}
          {tab === 'documents' ? (
            <Documents application={application} documents={documents} onUpload={may.note ? (form) => uploadStaffDocument(id, form, setState, notify) : null} />
          ) : null}
          {tab === 'timeline' ? <Timeline events={events} onNote={may.note ? (message) => act('note', { message }, 'Note added') : null} /> : null}
        </div>

        <aside className="space-y-4">
          <RulesPanel prescreen={prescreen} canRerun={may.work} onRerun={() => post('/prescreen', {}, 'Policy rules run again')} />
          <AffordabilityPanel application={application} prescreen={prescreen} />
          {may.work || may.decide ? <AiReviewPanel prescreen={prescreen} /> : null}
          <StagesPanel
            workflow={workflow}
            application={application}
            canReopen={may.work}
            onComplete={(stage) => setDialog({ type: 'complete_stage', stage })}
            onReopen={(stage) => setDialog({ type: 'reopen_stage', stage })}
          />
          <ChecklistPanel
            application={application}
            stages={{ checklist: workflow?.checklist }}
            editable={checklistEditable}
            onToggle={(check, done) =>
              done ? setDialog({ type: 'check', check }) : act('check', { check, done: false }, 'Check reopened').catch((error) => notify(error.message, { tone: 'error' }))
            }
          />
          <AppraisalsPanel appraisals={appraisals} />
          <CrbPanel
            reports={crbReports}
            provider={crbProvider}
            hasConsent={hasCrbConsent}
            canRun={may.work}
            pulling={crbPull.status === 'pulling'}
            error={crbPull.status === 'error' ? crbPull.message : null}
            onRun={() => pullCrb('Credit report added')}
          />
          <LocationPanel points={locations} facts={prescreen?.facts} onLogVisit={may.note ? (position) => post('/visits', position, 'Visit logged') : null} />
          <LmsPanel
            application={application}
            lmsConfigured={lmsConfigured}
            canAct={may.disburse}
            onSend={() => post('/lms/send', {}, 'Sent to the LMS').catch((error) => notify(error.message, { tone: 'error' }))}
            onReconcile={() => setDialog({ type: 'reconcile' })}
          />
          <SignaturesPanel signatures={signatures} applicationId={application.id} />
          <ConsentPanel consents={consents} />
        </aside>
      </div>

      <CaseDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        application={application}
        lastRecommendation={lastRecommendation}
        officers={eligibleOfficers}
        user={user}
        act={act}
        post={post}
        requireSignature={offersRequireSignature}
      />
    </div>
  )
}

/** Accepting the offer in person: the customer reads back the code emailed to them. */
function AcceptOfferDialog({ open, onOpenChange, application, user, act, requireSignature }) {
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [signature, setSignature] = useState(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setSent(false)
      setError('')
      setName(application.applicantName || '')
      setSignature(null)
    }
  }, [open, application.applicantName])

  const sendCode = async () => {
    setError('')
    const response = await fetch('/api/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: application.applicantEmail, purpose: 'offer', agentName: user.name }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) setError(body.message || 'The code could not be sent.')
    else setSent(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await act('record_acceptance', requireSignature ? { code, signature: { name: name.trim(), ...signature } } : { code }, requireSignature ? 'Offer signed and accepted' : 'Offer accepted')
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requireSignature ? 'The customer signs and accepts' : 'Record the customer’s acceptance'}</DialogTitle>
          <DialogDescription>
            {money(application.approvedAmount ?? application.amount)} over {application.approvedTenure ?? application.tenure} months, {money(application.monthlyInstalment)} a month, {money(application.totalRepayable)} in total.
            {requireSignature
              ? ' Go through the offer letter and agreement with the customer (Documents tab). They sign below on this device, then read back the code we email them.'
              : ' We email the customer a code; when they read it to you, enter it here.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {requireSignature ? (
            <div className="space-y-3 rounded-lg border p-3">
              <label htmlFor="accept-signer" className="text-sm font-medium text-foreground">
                The customer’s full name
              </label>
              <Input id="accept-signer" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
              <SignaturePad name={name} onChange={setSignature} />
            </div>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={sendCode}>
            {sent ? 'Send another code' : `Email the code to ${application.applicantEmail}`}
          </Button>
          <Input
            aria-label="Customer’s code"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-44 text-center font-semibold tracking-[0.3em]"
          />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={code.length < 6 || busy || (requireSignature && (!signature || name.trim().length < 3))}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {requireSignature ? 'Sign and accept' : 'Record acceptance'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const uploadStaffDocument = async (id, form, setState, notify) => {
  const response = await fetch(`/api/v1/applications/${id}/documents`, { method: 'POST', body: form, credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'The upload failed.')
  setState({ status: 'ready', ...body })
  notify('Document added')
}

function BackLink() {
  return (
    <Link to="/admin/applications" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Applications
    </Link>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/**
 * Buttons for the current state's actions (the workflow, src/config/workflow.js), grouped
 * the way people think of them: approve, decline and send back in one state are one
 * "Decide"; one person's decision is a "Recommend"; a stage's own step is done from the
 * Stages panel. Actions this person can't take say why, instead of disappearing.
 */
export const groupActions = (actions) => {
  const decide = actions.filter((action) => ['approve', 'reject', 'return'].includes(action.kind) && !action.singleStep)
  const hasDecision = decide.some((action) => action.kind === 'approve')
  const single = actions.filter((action) => action.singleStep)
  const groups = []
  if (single.length) groups.push({ key: 'single', type: 'recommend', label: 'Recommend', actions: single, single: true })
  for (const action of actions) {
    if (action.singleStep || (hasDecision && decide.includes(action))) continue
    if (action.kind === 'recommend') groups.push({ key: action.id, type: 'recommend', label: action.label, actions: [action] })
    else if (action.kind === 'pay_out') groups.push({ key: action.id, type: 'pay_out', label: action.label, actions: [action] })
    else if (action.kind === 'move') groups.push({ key: action.id, type: action.claim ? 'claim' : 'move', label: action.label, actions: [action] })
    else groups.push({ key: action.id, type: action.kind, label: action.label, actions: [action] })
  }
  if (hasDecision) groups.push({ key: 'decide', type: 'decide', label: 'Decide', actions: decide })
  return groups
}

function CaseActions({ application, workflow, may, canTake, hasEligibleOfficers, onOpen, onClaim, onTake, onTakeHere }) {
  const [busy, setBusy] = useState(null)
  const notify = useToast()
  const run = (key, fn) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const { status } = application
  const unassigned = !application.assignedOfficer
  const open = OPEN_STATUSES.includes(status)
  const withdrawable = WITHDRAWABLE_STATUSES.includes(status)
  const waiting = status === 'info_requested'
  const state = workflow?.state
  // A stage's step is marked done from the Stages panel; here it only says what's next.
  const stepHere = state?.trackProgress
  const groups = groupActions((workflow?.actions || []).filter((action) => !(stepHere && action.kind === 'move')))
  const hints = []

  const buttons = groups.map((group) => {
    const usable = group.actions.filter((action) => !action.blocked)
    if (!usable.length) {
      if (!waiting) hints.push(group.actions[0].blocked)
      return null
    }
    const [first] = usable
    if (group.type === 'claim') {
      return (
        <Button key={group.key} onClick={run(group.key, () => onClaim(first))} disabled={Boolean(busy)}>
          {busy === group.key ? <Loader2 className="animate-spin" /> : null}
          {group.label}
        </Button>
      )
    }
    const dialogFor = { recommend: 'recommend', decide: 'decide', pay_out: 'disbursed', move: 'move', return: 'return', reject: 'reject' }
    return (
      <Button
        key={group.key}
        variant={group.type === 'reject' ? 'outline' : group.type === 'pay_out' || group.type === 'return' ? 'outline' : 'default'}
        onClick={() => onOpen({ type: dialogFor[group.type], group, action: first })}
      >
        {group.type === 'pay_out' ? <CheckCircle2 /> : null}
        {group.label}
      </Button>
    )
  })

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {may.record && withdrawable ? (
        <Button variant="ghost" onClick={() => onOpen({ type: 'withdraw' })}>
          Withdraw
        </Button>
      ) : null}
      {state?.roles?.length && open && workflow.worksHere && !application.stateAssignee ? (
        canTake ? (
          <Button variant="outline" onClick={run('take-state', onTakeHere)} disabled={Boolean(busy)}>
            {busy === 'take-state' ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Take the case
          </Button>
        ) : (
          <p className="self-center text-sm text-muted-foreground">This amount is outside your assignment range.</p>
        )
      ) : null}
      {!state?.roles?.length && may.work && open && unassigned ? (
        canTake ? (
          <Button variant="outline" onClick={run('take', onTake)} disabled={Boolean(busy)}>
            {busy === 'take' ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Take the case
          </Button>
        ) : (
          <p className="self-center text-sm text-muted-foreground">This amount is outside your assignment range.</p>
        )
      ) : null}
      {may.assign && open ? (
        hasEligibleOfficers ? (
          <Button variant="ghost" onClick={() => onOpen({ type: 'assign' })}>
            {unassigned ? 'Assign' : 'Reassign'}
          </Button>
        ) : (
          <p className="self-center text-sm text-muted-foreground">No active loan officers match this amount.</p>
        )
      ) : null}
      {may.work && state?.askApplicant && !waiting ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'request_info' })}>
          Ask the applicant
        </Button>
      ) : null}
      {may.work && waiting ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'cancel_request' })}>
          Cancel the request
        </Button>
      ) : null}
      {stepHere && !waiting ? <p className="max-w-xs self-center text-sm text-muted-foreground">Next: {state.stepName}</p> : null}
      {may.record && state?.type === 'offer' ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'accept' })}>
          Record acceptance
        </Button>
      ) : null}
      {buttons}
      {[...new Set(hints)].slice(0, 1).map((hint) => (
        <p key={hint} className="max-w-xs self-center text-sm text-muted-foreground">
          {hint}
        </p>
      ))}
    </div>
  )
}

/** The recommend dialog's choices: both verdicts for a recommendation, or the decision actions a person may take. */
const recommendVerdicts = (dialog) => {
  if (dialog?.type !== 'recommend') return []
  const approve = { value: 'approve', label: 'Approve', hint: 'On the terms below' }
  const decline = { value: 'decline', label: 'Decline', hint: 'The applicant is told it was not approved' }
  if (!dialog?.group?.single) return [approve, decline]
  const usable = dialog.group.actions.filter((action) => !action.blocked)
  return [...(usable.some((action) => action.kind === 'approve') ? [approve] : []), ...(usable.some((action) => action.kind === 'reject') ? [decline] : [])]
}

/** The decide dialog's choices: the approve, decline and send-back actions this person may take, labelled as the workflow names them. */
const decideVerdicts = (dialog) =>
  (dialog?.type === 'decide' ? dialog.group?.actions || [] : [])
    .filter((action) => !action.blocked)
    .map((action) => ({
      value: { approve: 'approve', reject: 'decline', return: 'return' }[action.kind],
      label: action.kind === 'return' ? action.label : { approve: 'Approve', reject: 'Decline' }[action.kind],
      hint: action.kind === 'return' ? `Back to “${action.toLabel}”` : undefined,
      actionId: action.id,
    }))

function CaseDialogs({ dialog, onClose, application, lastRecommendation, officers, user, act, post, requireSignature }) {
  const open = (type) => dialog?.type === type
  const common = (type) => ({ open: open(type), onOpenChange: (value) => !value && onClose() })
  return (
    <>
      <ActionDialog
        {...common('request_info')}
        title="Ask the applicant for something"
        description="They see this on their page and get an email. The case waits until they reply."
        fields={[{ name: 'message', label: 'What do they need to send or explain?', type: 'textarea', rows: 4 }]}
        submitLabel="Send request"
        onSubmit={(values) => act('request_info', values, 'Request sent to the applicant')}
      />
      <ActionDialog
        {...common('check')}
        title={`Mark as done`}
        description="Note what you checked, so the approver and auditors can see it."
        fields={[{ name: 'note', label: 'What did you check?', type: 'textarea', hint: 'For example: NRC original seen, matches photo.' }]}
        submitLabel="Mark as done"
        onSubmit={(values) => act('check', { check: dialog?.check, done: true, note: values.note }, 'Check recorded')}
      />
      <ActionDialog
        {...common('complete_stage')}
        title={`Mark “${dialog?.stage?.label || ''}” as done`}
        description={dialog?.stage?.description || 'Recorded with your name and the time, on the case timeline.'}
        fields={[{ name: 'note', label: 'Note (optional)', type: 'textarea', rows: 3, optional: true, hint: 'For example: committee minutes reference, who you spoke to.' }]}
        submitLabel="Mark as done"
        onSubmit={(values) => act('transition', { actionId: dialog?.stage?.moveActionId, note: values.note }, `${dialog?.stage?.label} done`)}
      />
      <ActionDialog
        {...common('reopen_stage')}
        title={`Reopen “${dialog?.stage?.label || ''}”?`}
        description="It, and any later stage in the same part of the flow, will need doing again."
        fields={[{ name: 'reason', label: 'Why?', type: 'textarea', rows: 3 }]}
        submitLabel="Reopen"
        onSubmit={(values) => act('reopen_stage', { stage: dialog?.stage?.id, reason: values.reason }, 'Stage reopened')}
      />
      <ActionDialog
        {...common('recommend')}
        title={dialog?.group?.single ? 'Make the decision' : dialog?.group?.label && dialog.group.label !== 'Recommend' ? dialog.group.label : 'Recommend a decision'}
        description={dialog?.group?.single ? 'Your decision stands, within your approval limit.' : `A colleague reviews your recommendation and makes the final decision${dialog?.action?.toLabel ? ` (${dialog.action.toLabel})` : ''}.`}
        initial={{ verdict: recommendVerdicts(dialog)[0]?.value || 'approve', amount: application.amount, tenure: application.tenure }}
        fields={[
          {
            name: 'verdict',
            label: dialog?.group?.single ? 'Decision' : 'Your recommendation',
            type: 'choice',
            options: recommendVerdicts(dialog),
          },
          { name: 'amount', label: 'Amount (K)', type: 'number', showIf: (values) => values.verdict === 'approve', hint: `Asked for ${money(application.amount)}` },
          { name: 'tenure', label: 'Tenure (months)', type: 'number', showIf: (values) => values.verdict === 'approve' },
          { name: 'conditions', label: 'Conditions (optional)', type: 'textarea', rows: 2, showIf: (values) => values.verdict === 'approve' },
          { name: 'rationale', label: 'Why', type: 'textarea', hint: 'Staff only. The applicant never sees this.' },
        ]}
        submitLabel={(values) => (values.verdict === 'approve' ? 'Recommend approval' : 'Recommend decline')}
        tone={(values) => (values.verdict === 'decline' ? 'destructive' : 'default')}
        onSubmit={(values) => {
          const terms = { rationale: values.rationale, conditions: values.conditions, amount: Number(values.amount), tenure: Number(values.tenure) }
          if (!dialog?.group?.single) return act('transition', { actionId: dialog?.action?.id, verdict: values.verdict, ...terms }, 'Recommendation recorded')
          const chosen = dialog.group.actions.find((action) => (values.verdict === 'decline' ? action.kind === 'reject' : action.kind === 'approve'))
          return act('transition', { actionId: chosen?.id, ...terms }, values.verdict === 'decline' ? 'Declined' : 'Approved')
        }}
      />
      <ActionDialog
        {...common('decide')}
        title="Make the decision"
        description={
          lastRecommendation
            ? `${lastRecommendation.officerName} recommended ${lastRecommendation.verdict === 'approve' ? `approving ${money(lastRecommendation.amount)} over ${lastRecommendation.tenure} months` : 'declining'}: “${lastRecommendation.rationale}”`
            : undefined
        }
        initial={{ verdict: lastRecommendation && decideVerdicts(dialog).some((option) => option.value === lastRecommendation.verdict) ? lastRecommendation.verdict : decideVerdicts(dialog)[0]?.value, amount: lastRecommendation?.amount ?? application.amount, tenure: lastRecommendation?.tenure ?? application.tenure }}
        fields={[
          {
            name: 'verdict',
            label: 'Decision',
            type: 'choice',
            options: decideVerdicts(dialog),
          },
          { name: 'amount', label: 'Amount (K)', type: 'number', showIf: (values) => values.verdict === 'approve' },
          { name: 'tenure', label: 'Tenure (months)', type: 'number', showIf: (values) => values.verdict === 'approve' },
          { name: 'rationale', label: 'Why', type: 'textarea', hint: 'Staff only.' },
        ]}
        submitLabel={(values) => ({ approve: 'Approve', decline: 'Decline', return: 'Send back' })[values.verdict]}
        tone={(values) => (values.verdict === 'decline' ? 'destructive' : 'default')}
        onSubmit={(values) =>
          act(
            'transition',
            { actionId: decideVerdicts(dialog).find((option) => option.value === values.verdict)?.actionId, rationale: values.rationale, amount: Number(values.amount), tenure: Number(values.tenure) },
            { approve: 'Approved', decline: 'Declined', return: 'Sent back for more work' }[values.verdict]
          )
        }
      />
      <ActionDialog
        {...common('assign')}
        title="Assign the case"
        initial={{ officerId: application.assignedOfficer || user.id }}
        fields={[{ name: 'officerId', label: 'Loan officer', type: 'select', options: officers.map((officer) => ({ value: officer.id, label: officer.name })) }]}
        submitLabel="Assign"
        onSubmit={(values) => act('assign', values, 'Case assigned')}
      />
      <ActionDialog
        {...common('disbursed')}
        title="Mark as paid out"
        description="Record the payout when the LMS doesn’t report it back."
        fields={[{ name: 'reference', label: 'Payout or LMS reference (optional)' }]}
        submitLabel="Mark as paid out"
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, reference: values.reference }, 'Marked as paid out')}
      />
      <ActionDialog
        {...common('move')}
        title={dialog?.action?.label || ''}
        description={dialog?.action ? `The case moves to “${dialog.action.toLabel}”.` : undefined}
        fields={[{ name: 'note', label: dialog?.action?.requireNote ? 'Note' : 'Note (optional)', type: 'textarea', rows: 3, optional: !dialog?.action?.requireNote }]}
        submitLabel={dialog?.action?.label || 'Continue'}
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, note: values.note }, `Moved to ${dialog?.action?.toLabel}`)}
      />
      <ActionDialog
        {...common('return')}
        title={dialog?.action?.label || 'Send back'}
        description={dialog?.action ? `The case goes back to “${dialog.action.toLabel}”. Steps done since then need doing again.` : undefined}
        fields={[{ name: 'rationale', label: 'Why?', type: 'textarea', rows: 3 }]}
        submitLabel={dialog?.action?.label || 'Send back'}
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, rationale: values.rationale }, `Sent back to ${dialog?.action?.toLabel}`)}
      />
      <ActionDialog
        {...common('reject')}
        title={dialog?.action?.label || 'Reject'}
        description="The applicant is told it was not approved. They never see your reason."
        fields={[{ name: 'rationale', label: 'Why', type: 'textarea', hint: 'Staff only.' }]}
        submitLabel={dialog?.action?.label || 'Reject'}
        tone="destructive"
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, rationale: values.rationale }, 'Declined')}
      />
      <ActionDialog
        {...common('cancel_request')}
        title="Cancel the request to the applicant?"
        description="The case carries on without their reply. They're told nothing more is needed for now."
        fields={[{ name: 'reason', label: 'Why (optional)', type: 'textarea', rows: 2, optional: true }]}
        submitLabel="Cancel the request"
        onSubmit={(values) => act('cancel_request', values, 'Request withdrawn')}
      />
      <ActionDialog
        {...common('withdraw')}
        title="Withdraw the application"
        description="Only at the customer’s request. They’re told it was withdrawn at their request."
        fields={[{ name: 'reason', label: 'What did the customer say?', type: 'textarea' }]}
        submitLabel="Withdraw"
        tone="destructive"
        onSubmit={(values) => act('withdraw', values, 'Withdrawn')}
      />
      <AcceptOfferDialog open={open('accept')} onOpenChange={(value) => !value && onClose()} application={application} user={user} act={act} requireSignature={requireSignature} />
      <ActionDialog
        {...common('reconcile')}
        title="Is it in the LMS?"
        description="The LMS didn’t confirm it received this application. Look it up there before doing anything else — sending again could create a duplicate loan."
        initial={{ found: 'yes' }}
        fields={[
          {
            name: 'found',
            label: 'What did you find?',
            type: 'choice',
            options: [
              { value: 'yes', label: 'It’s there', hint: 'Record its reference' },
              { value: 'no', label: 'It isn’t there', hint: 'Allow sending again' },
            ],
          },
          { name: 'reference', label: 'LMS loan reference', showIf: (values) => values.found === 'yes' },
        ]}
        submitLabel="Save"
        onSubmit={(values) => post('/lms/reconcile', { found: values.found === 'yes', reference: values.reference }, 'LMS status updated')}
      />
    </>
  )
}

function Details({ application }) {
  const sections = useMemo(() => sectionsFor(application), [application])
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <section key={section.title} className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
          <dl className="mt-3 space-y-2.5">
            {section.rows
              .filter(([, value]) => value)
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
  )
}

/** Document list beside a viewer, with the AI findings for the one on screen. */
function Documents({ application, documents, onUpload }) {
  const [selectedId, setSelectedId] = useState(documents[0]?.id || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const selected = documents.find((document) => document.id === selectedId) || documents[0]
  const src = selected ? `/api/v1/applications/${application.id}/documents/${selected.id}` : null
  const isImage = selected?.contentType?.startsWith('image/')

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('label', file.name)
      form.append('file', file)
      await onUpload(form)
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        <ul className="space-y-1">
          {documents.map((document) => {
            const flagged = document.aiAnalysis && (document.aiAnalysis.matchesExpectedType === false || document.aiAnalysis.authenticityConcerns?.length || document.aiAnalysis.issues?.length)
            return (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(document.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected?.id === document.id ? 'bg-card shadow-sm ring-1 ring-border' : 'hover:bg-card/60'
                  )}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{document.label}</span>
                    <span className="block text-xs text-muted-foreground">{document.source === 'applicant' ? 'From the application' : document.source === 'info_response' ? 'Sent after a request' : document.source === 'system' ? (document.meta?.signed ? 'Signed by the customer' : `Generated, template version ${document.meta?.templateVersion ?? '?'}`) : 'Added by staff'}</span>
                  </span>
                  {flagged ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Has findings" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
        {onUpload ? (
          <>
            <input ref={input} type="file" accept=".pdf,image/*" className="sr-only" onChange={upload} aria-label="Add a document" />
            <Button variant="outline" size="sm" className="w-full" onClick={() => input.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              Add a document
            </Button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </>
        ) : null}
      </div>

      {selected ? (
        <div className="min-w-0 space-y-3">
          <DocumentFindings application={application} document={selected} />
          <div className="overflow-hidden rounded-xl border bg-muted/40">
            <div className="flex items-center justify-between border-b bg-card px-4 py-2 text-sm">
              <span className="truncate font-medium text-foreground">{selected.filename}</span>
              <a href={src} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
                Open
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
            {isImage ? (
              <img src={src} alt={selected.label} className="mx-auto max-h-[70vh] object-contain p-4" />
            ) : (
              <iframe key={selected.id} src={src} title={selected.label} className="h-[70vh] w-full border-0 bg-white" />
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No documents.</p>
      )}
    </div>
  )
}

const expectedForSlot = (application, slot) => {
  const data = application.data
  if (application.loanType === 'personal') {
    const info = data?.personalInfo || {}
    const name = [info.firstName, info.middleName, info.surname].filter(Boolean).join(' ')
    if (slot === 'payslips' || slot === 'nrcCopy') return { name, nrc: info.nrc }
    if (slot === 'bankStatements' || slot === 'tpin') return { name }
    return {}
  }
  const director = /^director\.(\d+)\.nrc$/.exec(slot)
  if (director) {
    const person = data?.directorInfo?.directors?.[Number(director[1])] || {}
    return { name: person.name, nrc: person.nrc }
  }
  if (['orderOrInvoice', 'passportPhoto'].includes(slot) || slot.startsWith('director.') || slot.startsWith('extra.') || slot.startsWith('response.')) return {}
  return { companyName: data?.businessInfo?.companyName, holderIsCompany: true }
}

function DocumentFindings({ application, document }) {
  const analysis = document.aiAnalysis
  if (!analysis) {
    return <p className="text-xs text-muted-foreground">No automatic check for this document.</p>
  }
  const mismatches = findFormMismatches(analysis, expectedForSlot(application, document.slot))
  const extracted = Object.entries(analysis.extracted || {}).filter(([, value]) => value)
  const problems = [
    ...(analysis.matchesExpectedType === false ? [`Looks like a ${analysis.detectedType || 'different document'}, not the one asked for.`] : []),
    ...(analysis.issues || []).map((issue) => issue.message),
    ...mismatches,
  ]
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        Automatic check{analysis.sample ? ' (sample data)' : ''}: {analysis.detectedType}, {analysis.legibility === 'clear' ? 'clear' : analysis.legibility === 'partly_legible' ? 'partly legible' : 'hard to read'}
      </p>
      {analysis.authenticityConcerns?.length ? (
        <div className="flex gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Possible tampering</p>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {analysis.authenticityConcerns.map((concern) => (
                <li key={concern}>{concern}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {problems.length ? (
        <ul className="space-y-1">
          {problems.map((problem) => (
            <li key={problem} className="flex gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Matches what was asked for and agrees with the form.
        </p>
      )}
      {extracted.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-xs sm:grid-cols-3">
          {extracted.map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

const EVENT_ICONS = { note: MessageSquarePlus }

function Timeline({ events, onNote }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onNote(note)
      setNote('')
    } catch (noteError) {
      setError(noteError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {onNote ? <form onSubmit={submit} className="rounded-xl border bg-card p-4">
        <label htmlFor="case-note" className="text-sm font-medium text-foreground">
          Add an internal note
        </label>
        <textarea
          id="case-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Visible to staff only"
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" disabled={busy || note.trim().length < 3}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </form> : null}
      <ol className="relative space-y-5 before:absolute before:inset-y-2 before:left-[5px] before:w-px before:bg-border">
        {events.map((event) => {
          const Icon = EVENT_ICONS[event.type]
          return (
            <li key={event.id} className="relative pl-6">
              <span
                className={cn('absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-background', event.type === 'note' ? 'bg-muted-foreground' : event.toStatus ? 'bg-primary' : 'bg-primary/50')}
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">
                {Icon ? <Icon className="mr-1 inline size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
                {event.message}
              </p>
              <p className="text-xs text-muted-foreground">
                {event.actorLabel}, {dateTime(event.at)}
                {event.visibleToCustomer ? ', shown to the applicant' : ''}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
