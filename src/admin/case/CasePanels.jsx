import React, { useState } from 'react'
import { AlertTriangle, Check, CircleDashed, Loader2, MapPin, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LMS_SYNC_LABELS } from '@/config/applications'
import { checklistOf } from '@/config/stages'
import { PHASES } from '@/config/workflow'
import { roleLabel } from '@/config/roles'
import { FACTS, OUTCOMES, describeCondition, formatFact } from '@/config/creditRules'
import { consentText } from '@/config/consent'
import { useBranding } from '@/components/brand/BrandingProvider'
import { OutcomeMark, Panel, dateTime, money, timeAgo } from '../components'
import { LocationMap } from './LocationMap'

const OUTCOME_ORDER = { decline: 0, refer: 1, warn: 2 }

/** The credit rules' result: what fired, with the actual value beside the threshold. */
export function RulesPanel({ prescreen, canRerun, onRerun }) {
  const [busy, setBusy] = useState(false)
  const rerun = async () => {
    setBusy(true)
    try {
      await onRerun()
    } finally {
      setBusy(false)
    }
  }

  if (!prescreen) {
    return (
      <Panel title="Policy rules">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Prescreening…
        </p>
      </Panel>
    )
  }
  const fired = prescreen.ruleResults.filter((result) => result.state === 'fired').sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome])
  const unknown = prescreen.ruleResults.filter((result) => result.state === 'not_evaluated')
  const passed = prescreen.ruleResults.filter((result) => result.state === 'passed')

  return (
    <Panel
      title="Policy rules"
      description={`Version ${prescreen.rulesetVersion}, run ${timeAgo(prescreen.updatedAt)}`}
      action={
        canRerun ? (
          <Button variant="ghost" size="sm" onClick={rerun} disabled={busy} title="Run the current rules again">
            <RefreshCw className={cn(busy && 'animate-spin')} />
            <span className="sr-only">Run again</span>
          </Button>
        ) : null
      }
    >
      <OutcomeMark outcome={prescreen.outcome} className="text-sm" />
      {fired.length ? (
        <ul className="mt-4 space-y-3">
          {fired.map((result) => (
            <li key={result.id} className="flex gap-2.5 text-sm">
              <AlertTriangle
                className={cn('mt-0.5 size-4 shrink-0', result.outcome === 'decline' ? 'text-destructive' : result.outcome === 'refer' ? 'text-warning' : 'text-muted-foreground')}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-foreground">{result.message}</p>
                <p className="text-xs text-muted-foreground">
                  {OUTCOMES[result.outcome].label}. {FACTS[result.fact]?.label}: {formatFact(result.fact, result.actual)}
                  {result.operator !== 'missing' ? ` (rule: ${describeCondition(result).replace(`${FACTS[result.fact]?.label} `, '')})` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No rule raised a concern.</p>
      )}
      {unknown.length || passed.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            {passed.length} passed{unknown.length ? `, ${unknown.length} could not be checked` : ''}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {unknown.map((result) => (
              <li key={result.id} className="flex gap-2 text-xs text-muted-foreground">
                <CircleDashed className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {describeCondition(result)}: not known
              </li>
            ))}
            {passed.map((result) => (
              <li key={result.id} className="flex gap-2 text-xs text-muted-foreground">
                <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
                {FACTS[result.fact]?.label}: {formatFact(result.fact, result.actual)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  )
}

const FACT_SNAPSHOT = {
  personal: ['monthly_instalment', 'net_monthly_pay', 'debt_to_income', 'average_monthly_credits', 'applicant_age'],
  business: ['monthly_instalment', 'annual_turnover', 'loan_to_turnover', 'order_value', 'loan_to_order', 'business_age_months'],
}

/** The numbers behind affordability, as the server computed them. */
export function AffordabilityPanel({ application, prescreen }) {
  if (!prescreen) return null
  return (
    <Panel title="Affordability">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {FACT_SNAPSHOT[application.loanType].map((fact) => (
          <div key={fact}>
            <dt className="text-xs text-muted-foreground">{FACTS[fact].label}</dt>
            <dd className="text-sm font-medium tabular-nums text-foreground">{formatFact(fact, prescreen.facts[fact])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Amounts are read from the documents by the AI check. Verify them against the originals.</p>
    </Panel>
  )
}

/** The model's explanation. Advisory: shown next to the rules, never instead of them. */
export function AiReviewPanel({ prescreen }) {
  const review = prescreen?.aiReview
  if (!review && !prescreen?.aiError) return null
  return (
    <Panel title="AI review" description={review?.sample ? 'Sample review (demo data)' : 'Advisory. The rules and your judgement decide.'}>
      {review ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Risk: <span className="font-medium capitalize">{review.riskLevel}</span>
          </p>
          <p className="leading-relaxed text-muted-foreground">{review.summary}</p>
          {review.missingInformation?.length ? (
            <div>
              <p className="text-xs font-medium text-foreground">Missing information</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {review.missingInformation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The AI review couldn’t run for this application. The policy rules still apply.</p>
      )}
    </Panel>
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
    <div className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">
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

/** The officer's checklist (Settings → Stages). Ticking asks for a note of what was checked. */
export function ChecklistPanel({ application, stages, editable, onToggle }) {
  const checklist = checklistOf(stages)
  const required = checklist.filter((check) => check.requiredToApprove)
  return (
    <Panel
      title="Verification"
      description={editable && required.length ? `Required before recommending approval: ${required.map((check) => check.label.toLowerCase()).join(', ')}.` : undefined}
    >
      {application.checks?.zra ? <ZraResult zra={application.checks.zra} /> : null}
      <ul className="space-y-3">
        {checklist.map((check) => {
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
                  {check.requiredToApprove ? <span className="text-muted-foreground"> *</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">{state?.done ? `${state.note} (${state.by})` : check.hint}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
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
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => onComplete(step)} disabled={missing.length > 0}>
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
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            {points.map((point) => (
              <li key={point.id} className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', point.source === 'applicant' ? 'bg-primary' : 'bg-brand')} aria-hidden="true" />
                {point.source === 'applicant' ? 'Applicant at submission' : `Visit by ${point.capturedByName || 'staff'}`}
                {point.note ? `: ${point.note}` : ''}, {dateTime(point.capturedAt)}
                {point.accuracyMeters ? `, within ${point.accuracyMeters} m` : ''}
              </li>
            ))}
          </ul>
          {facts?.location_distance_km !== null && facts?.location_distance_km !== undefined ? (
            <p className="mt-2 text-xs text-muted-foreground">{Math.round(facts.location_distance_km)} km from the stated address.</p>
          ) : null}
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
