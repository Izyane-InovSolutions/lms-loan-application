import React, { useEffect, useState } from 'react'
import { AlertTriangle, Check, CircleDashed, Loader2, MapPin, Send, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { LMS_SYNC_LABELS } from '@/config/applications'
import { checklistOf } from '@/config/stages'
import { PHASES } from '@/config/workflow'
import { roleLabel } from '@/config/roles'
import { FACTS, formatFact } from '@/config/creditRules'
import { compareIncome } from '@/config/eligibility'
import { consentText } from '@/config/consent'
import { useBranding } from '@/components/brand/BrandingProvider'
import { Panel, dateTime, money, timeAgo } from '../components'
import { LocationMap } from './LocationMap'

const FACT_SNAPSHOT = {
  personal: ['monthly_instalment', 'net_monthly_pay', 'debt_to_income', 'average_monthly_credits', 'applicant_age'],
  business: ['monthly_instalment', 'annual_turnover', 'loan_to_turnover', 'order_value', 'loan_to_order', 'business_age_months'],
}

/**
 * The offer's conditions as a checklist (conditions.js): what must be done before the loan is
 * booked in the LMS and paid out. Each is ticked off with a note of what was seen; booking and
 * payout wait for the last one.
 */
export function ConditionsPanel({ application, canTick, onSet }) {
  const conditions = application.checks?.conditions || []
  const open = conditions.filter((condition) => !condition.met).length
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const booked = application.lmsSyncStatus === 'synced'
  const set = async (condition, met) => {
    setBusy(condition.id)
    setError('')
    try {
      await onSet(condition, met, notes[condition.id] || '')
      setNotes((prev) => ({ ...prev, [condition.id]: '' }))
    } catch (setError_) {
      setError(setError_.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Panel
      title="Conditions before booking"
      description={open ? `${open} of ${conditions.length} still open: the loan isn’t booked in the LMS or paid out until every one is met.` : 'Every condition is met.'}
    >
      <ul className="space-y-3">
        {conditions.map((condition) => (
          <li key={condition.id} className="rounded-md border p-3 text-sm">
            <div className="flex items-start gap-2">
              {condition.met ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className={cn('text-foreground', condition.met && 'text-muted-foreground')}>{condition.text}</p>
                {condition.met ? (
                  <p className="text-xs text-muted-foreground">
                    Met{condition.note ? `: ${condition.note}` : ''} — {condition.byName}, {timeAgo(condition.at)}
                  </p>
                ) : null}
              </div>
              {canTick && condition.met && !booked ? (
                <Button type="button" variant="ghost" size="sm" className="h-8" disabled={busy === condition.id} onClick={() => set(condition, false)}>
                  Reopen
                </Button>
              ) : null}
            </div>
            {canTick && !condition.met ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={`How “${condition.text}” was met`}
                  placeholder="How it was met (optional), e.g. letter from HR received"
                  value={notes[condition.id] || ''}
                  onChange={(event) => setNotes((prev) => ({ ...prev, [condition.id]: event.target.value }))}
                  className="h-9 flex-1 text-sm"
                />
                <Button type="button" size="sm" className="h-9" disabled={busy === condition.id} onClick={() => set(condition, true)}>
                  {busy === condition.id ? <Loader2 className="animate-spin" /> : <Check />}
                  Mark met
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </Panel>
  )
}

/**
 * How the applicant came to this product (data.eligibility, filed on submission): matched
 * from their documents, or chosen in the website's loan finder on what they said they earn;
 * the income it went on, and any product eligibility rule (Policy rules) not met. On a
 * finder application an unmet rule didn't stop them: it is for the officer to weigh.
 */
export function QualificationPanel({ application, product }) {
  const outcome = application.data.eligibility
  const matched = outcome.route === 'match'
  const failed = outcome.failed || []
  const unchecked = outcome.unchecked || []
  const incomeWord = application.loanType === 'personal' ? 'Net pay' : 'Monthly revenue'
  // A typed income set against what the documents show (only when the typed one was used).
  const comparison = outcome.incomeSource === 'stated' ? compareIncome(outcome.income, outcome.documentIncome) : null
  return (
    <Panel
      title="How they qualified"
      description={matched ? `Matched to ${product?.name || 'this product'} from their documents.` : `Chose ${product?.name || 'this product'} in the website’s loan finder, on what they said they earn.`}
      className="lg:col-span-2"
    >
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{incomeWord} it went on</dt>
          <dd className="font-medium text-foreground">
            {outcome.income ? money(outcome.income) : '—'}{' '}
            <span className="font-normal text-muted-foreground">{outcome.incomeSource === 'documents' ? '(from documents)' : '(stated, unverified)'}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{incomeWord} the documents show</dt>
          <dd className="font-medium text-foreground">{outcome.documentIncome ? money(outcome.documentIncome) : 'Not read'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Could borrow up to</dt>
          <dd className="font-medium text-foreground">
            {outcome.maxAmount ? money(outcome.maxAmount) : '—'}
            {outcome.budget ? <span className="font-normal text-muted-foreground"> at {money(outcome.budget)} a month</span> : null}
          </dd>
        </div>
      </dl>
      {comparison?.differs ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            The {incomeWord.toLowerCase()} they entered, {money(comparison.stated)}, doesn’t match the {application.loanType === 'personal' ? 'payslip' : 'bank statements'}: {money(comparison.found)} (
            {Math.round((Math.abs(comparison.stated - comparison.found) / comparison.found) * 100)}% {comparison.stated > comparison.found ? 'more' : 'less'} than the documents show).
          </span>
        </p>
      ) : null}
      {failed.length ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
            {outcome.documentIssuesAccepted
              ? 'The applicant chose to continue despite a document issue'
              : failed.length === 1
                ? 'An eligibility rule for this product isn’t met'
                : `${failed.length} eligibility rules for this product aren’t met`}
          </p>
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            {failed.map((rule) => (
              <li key={rule.id}>
                {rule.requirement} — the documents show {rule.actual}.
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4 text-success" aria-hidden="true" />
          Every product eligibility rule that could be checked is met.
        </p>
      )}
      {unchecked.length ? <p className="mt-2 text-xs text-muted-foreground">Couldn’t be checked from the documents: {unchecked.join('; ')}.</p> : null}
    </Panel>
  )
}

/** The GPS position against the typed home address: how far apart, or why they couldn't be compared. */
function AddressComparison({ location }) {
  if (!location?.address) return null
  const { address, km } = location
  return (
    <div className={cn('mt-3 rounded-md border p-3 text-xs', address.found === false ? 'border-warning/40 bg-warning/5' : 'bg-muted/30')}>
      <p className="text-muted-foreground">
        Home address typed: <span className="font-medium text-foreground">{address.typed ? `“${address.typed}”` : 'none'}</span>
      </p>
      {km !== null && km !== undefined ? (
        <p className="mt-1 text-foreground">
          Found on the map{address.label ? ` (${address.label})` : ''}: <span className="font-semibold">{km < 1 ? 'under 1 km' : `${Math.round(km)} km`}</span> from where they submitted.
        </p>
      ) : address.found === false ? (
        <p className="mt-1 text-foreground">This address couldn’t be found on the map, so it can’t be compared with the GPS position. Check it with the applicant.</p>
      ) : (
        <p className="mt-1 text-muted-foreground">Not compared with the GPS position yet.</p>
      )}
    </div>
  )
}

/** Figures an officer may enter by hand, by loan type (api/_lib/prescreen/reasons.js MANUAL_FIGURES). */
const MANUAL_FIGURES = {
  personal: [
    ['netPay', 'Net monthly pay', 'From the latest payslip'],
    ['averageMonthlyCredits', 'Average monthly bank credits', 'Money paid in per month, from the bank statement'],
  ],
  business: [
    ['averageMonthlyCredits', 'Average monthly bank credits', 'Money paid in per month, from the bank statement'],
    ['annualTurnover', 'Annual turnover', 'From the latest tax return'],
    ['orderValue', 'Order or invoice value', 'From the order or invoice'],
  ],
}

/**
 * The numbers behind affordability, as the server computed them: each with where it came
 * from (read by the AI, or entered by an officer) or, when unknown, why. Officers can
 * enter a figure the AI couldn't read, or correct one it misread; the rules run again.
 */
/** `editRequest` changing (a count) opens the figures for editing: the summary's "Enter the figure". */
export function AffordabilityPanel({ application, prescreen, onSaveFigures, editRequest = 0 }) {
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (editRequest && onSaveFigures) setEditing(true)
  }, [editRequest])
  if (!prescreen) return null
  const notes = prescreen.facts?._notes || { reasons: {}, sources: {} }
  // Why a figure is unknown, unless a rule that couldn't be checked already says so in the summary.
  const explained = new Set(prescreen.ruleResults.filter((result) => result.state === 'not_evaluated').map((result) => result.fact))
  const missing = FACT_SNAPSHOT[application.loanType].filter((fact) => notes.reasons?.[fact] && prescreen.facts[fact] == null && !explained.has(fact))
  return (
    <Panel
      title="Affordability"
      action={
        onSaveFigures && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Enter figures
          </Button>
        ) : null
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {FACT_SNAPSHOT[application.loanType].map((fact) => {
          const known = prescreen.facts[fact] != null
          return (
            <div key={fact}>
              <dt className="text-xs text-muted-foreground">{FACTS[fact].label}</dt>
              <dd className={cn('text-sm font-medium tabular-nums', known ? 'text-foreground' : 'text-warning')}>{known ? formatFact(fact, prescreen.facts[fact]) : 'Unknown'}</dd>
              {known && notes.sources?.[fact] ? <dd className="text-[11px] text-muted-foreground">{notes.sources[fact]}</dd> : null}
            </div>
          )
        })}
      </dl>
      {missing.length ? (
        <ul className="mt-4 space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          {missing.map((fact) => (
            <li key={fact}>
              <span className="font-medium">{FACTS[fact].label}: </span>
              {notes.reasons[fact]}
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <FiguresForm
          application={application}
          onCancel={() => setEditing(false)}
          onSave={async (values) => {
            await onSaveFigures(values)
            setEditing(false)
          }}
        />
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">Figures read by the AI come from the documents; check them against the originals. Entered figures replace the AI’s.</p>
    </Panel>
  )
}

/** Enter or correct the figures the rules use; a blank field goes back to what the AI read. */
function FiguresForm({ application, onCancel, onSave }) {
  const entered = application.checks?.figures || {}
  const fields = MANUAL_FIGURES[application.loanType] || []
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([key]) => [key, entered[key]?.value ?? ''])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave({ ...Object.fromEntries(fields.map(([key]) => [key, values[key] === '' ? null : values[key]])), note })
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">Read these from the documents. Leave one blank to use what the AI read.</p>
      {fields.map(([key, label, hint]) => (
        <label key={key} className="block text-sm">
          <span className="font-medium text-foreground">{label}</span>
          <span className="block text-xs text-muted-foreground">
            {hint}
            {entered[key] ? ` · entered by ${entered[key].byName}, ${timeAgo(entered[key].at)}` : ''}
          </span>
          <span className="mt-1 flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-sm text-muted-foreground">K</span>
            <input
              inputMode="decimal"
              value={values[key]}
              onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value.replace(/[^0-9.]/g, '') }))}
              className="h-9 w-full bg-transparent px-2 text-sm tabular-nums focus:outline-none"
              aria-label={label}
            />
          </span>
        </label>
      ))}
      <label className="block text-sm">
        <span className="font-medium text-foreground">Note</span>
        <input
          value={note}
          maxLength={300}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. From the August payslip"
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Save and re-run rules
        </Button>
      </div>
    </form>
  )
}

const ZRA_STATUS = {
  verified: { label: 'Verified with ZRA', tone: 'text-success', icon: ShieldCheck },
  mismatch: { label: 'ZRA record differs', tone: 'text-warning', icon: ShieldAlert },
  not_found: { label: 'Not found at ZRA', tone: 'text-destructive', icon: ShieldAlert },
  unavailable: { label: 'ZRA check didn’t run', tone: 'text-muted-foreground', icon: CircleDashed },
}

/** The automatic taxpayer check run after submission (api/_lib/zra/verifyApplication.js). */
function ZraResult({ zra }) {
  const status = ZRA_STATUS[zra.status] || ZRA_STATUS.unavailable
  const Icon = status.icon
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <p className={cn('flex items-center gap-2 font-medium', status.tone)}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {status.label}
        <span className="ml-auto text-xs font-normal text-muted-foreground">by {zra.lookupType}, {timeAgo(zra.at)}</span>
      </p>
      {zra.tpin ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {zra.name} · TPIN <span className="font-mono">{zra.tpin}</span>
        </p>
      ) : null}
      {zra.status === 'mismatch' ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-foreground">
          {zra.nameMatches === false ? <li>The name at ZRA differs from the application.</li> : null}
          {(zra.documentMismatches || []).map((document) => (
            <li key={document.slot}>
              {document.label} shows TPIN <span className="font-mono">{document.tpin}</span>.
            </li>
          ))}
        </ul>
      ) : null}
      {zra.status === 'unavailable' ? <p className="mt-1 text-xs text-muted-foreground">ZRA couldn’t be reached. Verify the taxpayer manually.</p> : null}
    </div>
  )
}

/**
 * The officer's checks (Settings → Stages), ticked where an action needs them: in the
 * recommend and stage dialogs. `only` limits it to those keys; `required` marks the ones
 * the action waits for.
 */
export function VerificationChecklist({ application, checklist, only, required = [], editable, onToggle, showZra = false }) {
  const checks = checklistOf({ checklist }).filter((check) => !only || only.includes(check.key))
  if (!checks.length && !(showZra && application.checks?.zra)) return null
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium text-foreground">Verification</legend>
      {showZra && application.checks?.zra ? <ZraResult zra={application.checks.zra} /> : null}
      <ul className="space-y-3">
        {checks.map((check) => {
          const { key } = check
          const state = application.checks?.[key]
          return (
            <li key={key} className="flex items-start gap-3">
              <button
                type="button"
                disabled={!editable}
                onClick={() => onToggle(key, !state?.done)}
                aria-pressed={Boolean(state?.done)}
                aria-label={`${check.label}: ${state?.done ? 'done' : 'not done'}`}
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                  state?.done ? 'border-success bg-success text-success-foreground' : 'border-input bg-background hover:border-primary'
                )}
              >
                {state?.done ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </button>
              <div className="min-w-0 text-sm">
                <p className="text-foreground">
                  {check.label}
                  {required.includes(key) ? <span className="text-muted-foreground"> (required)</span> : null}
                </p>
                {state?.done && state.by ? (
                  <p className="text-xs text-muted-foreground">
                    {state.by}, {timeAgo(state.at)}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

/**
 * The recorded steps of this case's workflow (its stage-like states), by part of the
 * journey: what is done, by whom, and the current one with a button for whoever may
 * complete it.
 */
export function StagesPanel({ workflow, application, onComplete, onReopen, canReopen }) {
  const steps = workflow?.steps || []
  if (!steps.length) return null
  const phases = [...new Set(steps.map((step) => step.phase))]
  const checkName = (key) => (workflow.checklist || []).find((check) => check.key === key)?.label?.toLowerCase() || key
  const move = (step) => workflow.actions.find((action) => action.id === step.moveActionId)
  return (
    <Panel title="Stages" description="This workspace’s own steps, done in order.">
      <div className="space-y-5">
        {phases.map((phase) => (
          <div key={phase}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{PHASES[phase]}</p>
            <ol className="mt-2 space-y-3">
              {steps
                .filter((step) => step.phase === phase)
                .map((step) => {
                  const progress = step.progress
                  const action = step.current ? move(step) : null
                  const allowed = action && !action.blocked
                  const missing = step.checks.filter((key) => !application.checks?.[key]?.done)
                  return (
                    <li key={step.id} className="flex items-start gap-3 text-sm">
                      <span
                        className={cn(
                          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                          progress?.done ? 'border-success bg-success text-success-foreground' : step.current ? 'border-primary' : 'border-input'
                        )}
                        aria-hidden="true"
                      >
                        {progress?.done ? <Check className="size-3.5" /> : step.current ? <CircleDashed className="size-3.5 text-primary" /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-foreground', step.current && 'font-medium')}>{step.label}</p>
                        {progress?.done ? (
                          <p className="text-xs text-muted-foreground">
                            {progress.byName}, {timeAgo(progress.at)}
                            {progress.note ? `: ${progress.note}` : ''}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {step.description || null}
                            {step.roles.length ? `${step.description ? ' ' : ''}For ${step.roles.map((role) => roleLabel(role).toLowerCase()).join(' or ')}.` : ''}
                            {missing.length && step.current ? ` Needs: ${missing.map(checkName).join(', ')}.` : ''}
                          </p>
                        )}
                        {allowed && application.status !== 'info_requested' ? (
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => onComplete(step)}>
                            Mark as done
                          </Button>
                        ) : null}
                        {step.reopenable && canReopen ? (
                          <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => onReopen(step)}>
                            Reopen
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
            </ol>
          </div>
        ))}
      </div>
    </Panel>
  )
}

const VERDICT_TEXT = { approve: 'Approve', decline: 'Decline', return: 'Sent back' }

/** Recommendations and decisions, newest first. */
export function AppraisalsPanel({ appraisals }) {
  if (!appraisals.length) return null
  return (
    <Panel title="Credit decisions">
      <ol className="space-y-4">
        {appraisals.map((appraisal) => (
          <li key={appraisal.id} className="text-sm">
            <p className="font-medium text-foreground">
              {appraisal.kind === 'recommendation' ? 'Recommendation' : 'Decision'}: {VERDICT_TEXT[appraisal.verdict]}
              {appraisal.amount ? ` ${money(appraisal.amount)} over ${appraisal.tenure} months` : ''}
            </p>
            <p className="mt-0.5 text-muted-foreground">{appraisal.rationale}</p>
            {appraisal.conditions ? <p className="mt-0.5 text-muted-foreground">Conditions: {appraisal.conditions}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {appraisal.officerName}, {dateTime(appraisal.createdAt)}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

const LMS_TONES = { synced: 'text-success', failed: 'text-destructive', uncertain: 'text-warning', sending: 'text-primary', pending: 'text-primary' }

/** The Frappe hand-off: status, and the actions that are safe in each state. */
export function LmsPanel({ application, lmsConfigured, canAct, onSend, onReconcile }) {
  if (!lmsConfigured && application.lmsSyncStatus === 'not_configured') return null
  const status = application.lmsSyncStatus
  return (
    <Panel title="Loan management system">
      <p className={cn('text-sm font-medium', LMS_TONES[status] || 'text-foreground')}>{LMS_SYNC_LABELS[status]}</p>
      {application.lmsReference ? <p className="mt-1 text-sm text-muted-foreground">LMS reference {application.lmsReference}</p> : null}
      {application.lmsError ? <p className="mt-1 text-xs text-muted-foreground">{application.lmsError}</p> : null}
      {canAct ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {['waiting', 'pending', 'failed'].includes(status) ? (
            <Button variant="outline" size="sm" onClick={onSend}>
              {status === 'failed' ? 'Try again' : 'Send now'}
            </Button>
          ) : null}
          {status === 'uncertain' ? (
            <Button variant="outline" size="sm" onClick={onReconcile}>
              I’ve checked the LMS
            </Button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

/** `pulling` and `error` come from the case page, which also pulls on its own when the case opens. */
export function CrbPanel({ reports, provider, hasConsent, canRun, onRun, pulling = false, error = null }) {
  if (!provider && !reports.length) return null
  const latest = reports[0]
  return (
    <Panel
      title="Credit bureau"
      description={
        latest?.report?.sample
          ? 'Sample data, not a real bureau report'
          : latest?.report?.testIdentity
            ? `Bureau test identity ${latest.report.testIdentity.nrc}, not this applicant’s report`
            : undefined
      }
    >
      {latest ? (
        <div className="space-y-1 text-sm">
          {latest.report.identity?.mismatch ? (
            <p role="alert" className="mb-2 flex gap-2 rounded-md bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The bureau returned NRC {latest.report.identity.reportedNrc}, not {latest.report.identity.requestedNrc}. Check this is the applicant before relying on it.
            </p>
          ) : null}
          <p className="text-2xl font-semibold tabular-nums text-foreground">{latest.score ?? '—'}</p>
          <p className="text-muted-foreground">{latest.report.band}</p>
          <p className="text-muted-foreground">{latest.report.summary}</p>
          {latest.report.reportData ? <CrbDetail report={latest.report} /> : null}
          <p className="text-xs text-muted-foreground">Pulled {timeAgo(latest.createdAt)}</p>
        </div>
      ) : pulling ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Pulling the credit report…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{hasConsent ? 'No report pulled yet.' : 'The applicant did not consent to a credit bureau check.'}</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {canRun && provider && hasConsent ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRun} disabled={pulling}>
          {pulling ? <Loader2 className="animate-spin" /> : <ShieldAlert />}
          {pulling ? 'Pulling…' : latest ? 'Pull a fresh report' : 'Run credit check'}
        </Button>
      ) : null}
    </Panel>
  )
}

/** A real bureau report's figures and accounts. Only credit staff receive `reportData`. */
function CrbDetail({ report }) {
  // Nothing came back, so there are no figures to show — only what the bureau said.
  if (report.found === false) {
    return report.responseCode === null || report.responseCode === undefined ? null : (
      <p className="pt-2 text-xs text-muted-foreground">Bureau response code {report.responseCode}</p>
    )
  }
  const accounts = report.reportData.accountList.filter(Boolean)
  const figures = [
    ['Grade', report.grade],
    ['Probability of default', report.probabilityOfDefault === null || report.probabilityOfDefault === undefined ? null : `${report.probabilityOfDefault}%`],
    ['Monthly commitments', money(report.commitments)],
    ['Outstanding', money(report.outstanding)],
    ['Arrears on record', report.accountsInArrears ? `${money(report.arrearsOnRecord)}, worst ${report.worstArrearDays} days` : 'None'],
    ['Written off', report.writtenOff],
    ['Enquiries on record', report.recentEnquiries],
    ['Bounced cheques', report.bouncedCheques],
  ].filter(([, value]) => value !== null && value !== undefined)
  return (
    <div className="pt-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {figures.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right tabular-nums text-foreground">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {report.reasonCodes?.length ? <p className="mt-2 text-xs text-muted-foreground">Reason codes: {report.reasonCodes.join(', ')}</p> : null}
      {accounts.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {accounts.length} account{accounts.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 space-y-1.5">
            {accounts.map((account, index) => (
              <li key={`${account.accountNo || 'account'}-${index}`} className="rounded-md border border-border p-2">
                <p className="text-foreground">
                  {account.accountType || 'Account'} · {account.accountStatus || 'status not given'}
                  {String(account.disputed).toLowerCase() === 'true' ? ' · disputed' : ''}
                </p>
                <p className="text-muted-foreground">
                  Balance {money(Number(account.balanceAmount ?? account.outstandingBalance) || 0)}
                  {Number(account.arrearAmount) > 0 ? `, ${money(Number(account.arrearAmount))} in arrears (${account.arrearDays || 0} days)` : ''}
                  {account.tradeSector ? `, ${account.tradeSector}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

export function LocationPanel({ points, facts, onLogVisit }) {
  // What the rules compared: the GPS position, and the home address the applicant typed.
  const location = facts?._notes?.location || null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const logVisit = () => {
    setError('')
    if (!navigator.geolocation) {
      setError('This device cannot share its location.')
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await onLogVisit({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy })
        } catch (visitError) {
          setError(visitError.message)
        } finally {
          setBusy(false)
        }
      },
      () => {
        setError('Location permission was refused. Allow it in the browser to log a visit.')
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  return (
    <Panel
      title="Location"
      action={
        onLogVisit ? (
          <Button variant="outline" size="sm" onClick={logVisit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <MapPin />}
            Log a visit here
          </Button>
        ) : null
      }
    >
      {points.length ? (
        <>
          <LocationMap points={points} />
          <ul className="mt-3 space-y-2.5 text-xs text-muted-foreground">
            {points.map((point) => {
              const coordinates = `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
              const compared = location?.gps && Number(location.gps.latitude).toFixed(5) === Number(point.latitude).toFixed(5) && Number(location.gps.longitude).toFixed(5) === Number(point.longitude).toFixed(5)
              return (
                <li key={point.id} className="flex items-start gap-2">
                  <span className={cn('mt-1 size-2 shrink-0 rounded-full', point.source === 'applicant' ? 'bg-primary' : 'bg-brand')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-foreground">
                      {point.source === 'applicant' ? 'Applicant at submission' : `Visit by ${point.capturedByName || 'staff'}`}
                      {point.note ? `: ${point.note}` : ''}
                    </span>
                    <span className="block">
                      GPS <span className="font-mono text-foreground">{coordinates}</span>
                      {point.accuracyMeters ? `, accurate to about ${point.accuracyMeters} m` : ''}
                      {compared && location.gps.place ? `, near ${location.gps.place}` : ''}
                    </span>
                    <span className="block">
                      {dateTime(point.capturedAt)} ·{' '}
                      <a href={`https://www.google.com/maps?q=${point.latitude},${point.longitude}`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                        Open in Google Maps
                      </a>
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
          <AddressComparison location={location} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No location was shared with this application.</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Panel>
  )
}

/**
 * The customer's signatures on their offer: who, when, how it was confirmed, and each
 * document's fingerprint before and after, with the signed copies.
 */
export function SignaturesPanel({ signatures, applicationId }) {
  if (!signatures?.length) return null
  return (
    <Panel title="Signature" description="Evidence kept with the signed documents.">
      <ul className="space-y-5">
        {signatures.map((signature) => (
          <li key={signature.id} className="space-y-3 text-sm">
            <img src={signature.image} alt={`Signature of ${signature.signerName}`} className="h-16 w-auto rounded border bg-white p-1" />
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Signed by</dt>
              <dd className="text-foreground">{signature.signerName}</dd>
              <dt className="text-muted-foreground">When</dt>
              <dd className="text-foreground">{dateTime(signature.signedAt)}</dd>
              <dt className="text-muted-foreground">How</dt>
              <dd className="text-foreground">
                {signature.method === 'typed' ? 'Typed name' : 'Drawn'}
                {signature.codeVerified ? `, confirmed by a code emailed to ${signature.signerEmail}` : ''}
                {signature.capturedBy ? ', in person with staff' : ''}
              </dd>
              <dt className="text-muted-foreground">From</dt>
              <dd className="text-foreground [overflow-wrap:anywhere]">{signature.ip || 'unknown'}</dd>
              <dt className="text-muted-foreground">Record</dt>
              <dd className={signature.sealValid === false ? 'font-medium text-destructive' : 'text-foreground'}>
                {signature.sealValid === true ? 'Sealed, unchanged since signing' : signature.sealValid === false ? 'Doesn’t match its seal: changed after signing' : 'Not sealed'}
              </dd>
            </dl>
            <ul className="space-y-2">
              {signature.documents.map((entry) => (
                <li key={entry.signedDocumentId} className="rounded-md border p-2 text-xs">
                  <a className="font-medium text-primary hover:underline" href={`/api/v1/applications/${applicationId}/documents/${entry.signedDocumentId}`} target="_blank" rel="noreferrer">
                    {entry.label} (signed)
                  </a>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground [overflow-wrap:anywhere]">Before: {entry.sha256}</p>
                  <p className="font-mono text-[10px] text-muted-foreground [overflow-wrap:anywhere]">Signed: {entry.signedSha256}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

const DOCUMENT_STATUS = {
  ready: { label: 'Not sent yet', tone: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', tone: 'bg-accent text-accent-foreground' },
  viewed: { label: 'Opened by the applicant', tone: 'bg-accent text-accent-foreground' },
  uploaded: { label: 'Uploaded: awaiting check', tone: 'bg-warning/15 text-warning' },
  signed: { label: 'Signed online', tone: 'bg-success/15 text-success' },
  received: { label: 'Received', tone: 'bg-success/15 text-success' },
}

/**
 * Documents sent to the applicant at workflow stages: where each stands, its files, and
 * marking one received once a signed copy is checked or a paper one handed in.
 */
export function StageDocumentsPanel({ documents, applicationId, canWork, onResend, onReceived }) {
  const [receiving, setReceiving] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  if (!documents?.length) return null

  const run = (key, task) => async () => {
    setBusy(key)
    setError('')
    try {
      await task()
      setReceiving(null)
      setNote('')
    } catch (runError) {
      setError(runError.message)
    } finally {
      setBusy(null)
    }
  }
  const file = (id, label) => (
    <a className="font-medium text-primary hover:underline" href={`/api/v1/applications/${applicationId}/documents/${id}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  )
  const waiting = documents.some((document) => !document.done && !document.offer)

  return (
    <Panel
      title="Documents to sign"
      description="Sent to the applicant at workflow stages."
      action={
        canWork && waiting ? (
          <Button variant="ghost" size="sm" onClick={run('resend', onResend)} disabled={Boolean(busy)}>
            {busy === 'resend' ? <Loader2 className="animate-spin" /> : <Send />}
            Resend email
          </Button>
        ) : null
      }
    >
      <ul className="space-y-3">
        {documents.map((document) => {
          const status = DOCUMENT_STATUS[document.status] || DOCUMENT_STATUS.ready
          return (
            <li key={document.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{document.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {document.stageLabel ? `${document.stageLabel}` : 'With the offer'}
                    {document.required ? ', required to move on' : ''}
                    {!document.requiresSignature ? ', no signature needed' : ''}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.tone)}>{status.label}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {file(document.id, 'As sent')}
                {document.signedDocumentId ? file(document.signedDocumentId, 'Signed copy') : null}
                {document.uploadedDocumentId ? file(document.uploadedDocumentId, 'Uploaded copy') : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {document.sentAt ? `Sent ${dateTime(document.sentAt)}` : 'Not emailed yet'}
                {document.viewedAt ? `; opened ${dateTime(document.viewedAt)}` : ''}
                {document.signedAt ? `; signed ${dateTime(document.signedAt)}` : ''}
                {document.uploadedAt ? `; copy uploaded ${dateTime(document.uploadedAt)}` : ''}
                {document.receivedAt ? `; received by ${document.receivedByName}, ${dateTime(document.receivedAt)}${document.receivedNote ? ` (${document.receivedNote})` : ''}` : ''}
              </p>
              {canWork && !document.done ? (
                receiving === document.id ? (
                  <div className="space-y-2">
                    <Input aria-label="Note" placeholder={document.uploadedDocumentId ? 'What you checked (optional)' : 'e.g. Paper copy handed in at the branch'} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={run(document.id, () => onReceived(document, note.trim()))} disabled={Boolean(busy)}>
                        {busy === document.id ? <Loader2 className="animate-spin" /> : <Check />}
                        Mark received
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReceiving(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setReceiving(document.id)}>
                    {document.uploadedDocumentId ? 'Checked: mark received' : 'Mark received'}
                  </Button>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </Panel>
  )
}

const CONSENT_LABELS = { data_processing: 'Terms and privacy notice', draft_contact: 'Contact about the unfinished application', location: 'Location sharing', crb: 'Credit bureau check', offer: 'Loan offer accepted' }
const METHOD_LABELS = { applicant_checkbox: 'by the applicant online', customer_code: 'by the customer’s emailed code, with an agent' }

export function ConsentPanel({ consents }) {
  const { name: brand } = useBranding()
  if (!consents.length) return null
  return (
    <Panel title="Consent">
      <ul className="space-y-2 text-sm">
        {consents.map((consent) => (
          <li key={consent.id} className="flex items-start gap-2">
            {consent.granted ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <span className="mt-0.5 size-4 shrink-0 text-center text-muted-foreground">–</span>}
            <span>
              <span className="text-foreground">{CONSENT_LABELS[consent.type]}</span>
              <span className="block text-xs text-muted-foreground" title={consentText(consent.type, brand)}>
                {consent.granted ? `Given ${METHOD_LABELS[consent.method] || ''}` : 'Not given'}, notice {consent.noticeVersion}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
