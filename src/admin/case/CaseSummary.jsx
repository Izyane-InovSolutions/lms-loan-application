import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, CircleDashed, ClipboardList, FileSearch, FileText, Gauge, Loader2, MapPin, RefreshCw, ShieldAlert, Sparkles, UserCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FACTS, OUTCOMES, describeCondition, formatFact } from '@/config/creditRules'
import { findFormMismatches } from '@/utils/documentChecks'
import { OutcomeMark, timeAgo } from '../components'

/*
 * Everything the automatic assessment found, before the officer reads the form or the
 * files: the policy rules' result, the AI's review, and each document's check — every
 * point with the evidence it rests on, so it can be opened and checked against the original.
 */

const OUTCOME_ORDER = { decline: 0, refer: 1, warn: 2 }
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
const RECOMMENDATIONS = {
  proceed: { label: 'Proceed', tone: 'text-success' },
  review: { label: 'Look closely', tone: 'text-warning' },
  decline_likely: { label: 'Decline likely', tone: 'text-destructive' },
}
const CATEGORIES = {
  affordability: 'Affordability',
  documents: 'Documents',
  consistency: 'Consistency',
  completeness: 'Completeness',
  authenticity: 'Authenticity',
  other: 'Other',
}

/** What each document should agree with on the form (api/_lib/prescreen/facts.js expectedFor). */
export const expectedForSlot = (application, slot) => {
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
  const company = {
    companyName: data?.businessInfo?.companyName,
    holderIsCompany: true,
  }
  // ZRA documents also print the company's TPIN.
  return ['taxClearance', 'latestTaxComplianceReturn'].includes(slot) ? { ...company, tpin: data?.businessInfo?.tpin } : company
}

/** One document's automatic check, as problems an officer can read. */
export const documentProblems = (application, document) => {
  const analysis = document.aiAnalysis
  if (!analysis) return { problems: [], tampering: [] }
  return {
    problems: [
      ...(analysis.matchesExpectedType === false ? [`Looks like a ${analysis.detectedType || 'different document'}, not the one asked for.`] : []),
      ...(analysis.issues || []).map((issue) => issue.message),
      ...findFormMismatches(analysis, expectedForSlot(application, document.slot)),
    ],
    tampering: analysis.authenticityConcerns || [],
  }
}

// The same tests the server counts for the document rules (api/_lib/prescreen/facts.js).
const CHECKABLE = (document) => !['passportPhoto', 'directorPassportPhoto'].includes(document.docType)
const DOCUMENT_TESTS = {
  documents_wrong_type: (document) => document.aiAnalysis?.matchesExpectedType === false,
  documents_illegible: (document) => ['illegible', 'partly_legible'].includes(document.aiAnalysis?.legibility),
  documents_outdated: (document) => (document.aiAnalysis?.issues || []).some((issue) => issue.code === 'expired' || issue.code === 'outdated'),
  documents_unchecked: (document) => CHECKABLE(document) && !document.aiAnalysis,
  identity_mismatches: (document, application) => Boolean(document.aiAnalysis) && findFormMismatches(document.aiAnalysis, expectedForSlot(application, document.slot)).length > 0,
  authenticity_concerns: (document) => Boolean(document.aiAnalysis?.authenticityConcerns?.length),
}

// Figures read from one kind of document, and the ratios worked out from them (api/_lib/prescreen/reasons.js).
const FROM_DOCUMENT = {
  net_monthly_pay: 'payslips',
  average_monthly_credits: 'bankStatements',
  annual_turnover: 'latestTaxComplianceReturn',
  order_value: 'orderOrInvoice',
}
const RATIO_OF = {
  debt_to_income: 'net_monthly_pay',
  instalment_to_credits: 'average_monthly_credits',
  loan_to_turnover: 'annual_turnover',
  loan_to_order: 'order_value',
}
const FROM_FORM = ['amount', 'tenure', 'monthly_instalment', 'applicant_age', 'age_at_maturity', 'business_age_months', 'directors_count']
const FROM_LOCATION = ['location_provided', 'location_distance_km', 'address_found']

/** What a rule's figure rests on: the documents it came from, or the form, location or bureau. */
const evidenceForFact = (fact, { application, documents, source }) => {
  const base = FROM_DOCUMENT[fact] ? fact : RATIO_OF[fact]
  if (base) {
    const uploads = documents.filter((document) => document.docType === FROM_DOCUMENT[base])
    return [
      ...(source?.startsWith('Entered by') ? [{ kind: 'entered', label: source }] : []),
      ...uploads.map((document) => ({ kind: 'document', document })),
      ...(RATIO_OF[fact] || ['amount', 'monthly_instalment'].includes(fact) ? [{ kind: 'form', label: 'Loan terms' }] : []),
    ]
  }
  if (DOCUMENT_TESTS[fact]) return documents.filter((document) => DOCUMENT_TESTS[fact](document, application)).map((document) => ({ kind: 'document', document }))
  if (FROM_FORM.includes(fact)) return [{ kind: 'form', label: 'Application form' }]
  if (FROM_LOCATION.includes(fact)) return [{ kind: 'location', label: 'Location and home address' }]
  if (fact === 'crb_score') return [{ kind: 'crb', label: 'Credit bureau report' }]
  return []
}

const EVIDENCE_ICONS = {
  form: ClipboardList,
  location: MapPin,
  crb: Gauge,
  entered: UserCheck,
}

function Evidence({ items, onOpenDocument, onOpenDetails }) {
  if (!items.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Based on</span>
      {items.map((item) => {
        const chip = 'inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground'
        if (item.kind === 'document') {
          return (
            <button
              key={item.document.id}
              type="button"
              onClick={() => onOpenDocument(item.document.id)}
              title={`Open ${item.document.filename}`}
              className={cn(chip, 'transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              <FileText className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.document.label}</span>
            </button>
          )
        }
        if (item.kind === 'missing') {
          return (
            <span key={item.label} className={cn(chip, 'text-muted-foreground')}>
              <FileText className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </span>
          )
        }
        const Icon = EVIDENCE_ICONS[item.kind]
        const content = (
          <>
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </>
        )
        return item.kind === 'form' ? (
          <button
            key={item.label}
            type="button"
            onClick={onOpenDetails}
            className={cn(chip, 'transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            {content}
          </button>
        ) : (
          <span key={item.label} className={chip}>
            {content}
          </span>
        )
      })}
    </div>
  )
}

// The AI's overall score, in bands (api/_lib/ai/prescreen.js asks for the same ones).
const SCORE_BANDS = [
  { min: 80, label: 'Strong', tone: 'text-success' },
  { min: 60, label: 'Fair', tone: 'text-primary' },
  { min: 40, label: 'Weak', tone: 'text-warning' },
  { min: 0, label: 'Poor', tone: 'text-destructive' },
]
export const scoreBand = (score) => SCORE_BANDS.find((band) => score >= band.min)

/** The AI's score out of 100 as a ring, with its band and the recommendation beside it. */
function ScoreCard({ review }) {
  const recommendation = RECOMMENDATIONS[review.recommendation]
  const scored = Number.isFinite(review.score)
  const band = scored ? scoreBand(review.score) : null
  const circumference = 2 * Math.PI * 34
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-background/60 px-4 py-3">
      <div className={cn('relative size-20 shrink-0', band?.tone || 'text-muted-foreground')}>
        <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" className="stroke-muted" />
          {scored ? (
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" stroke="currentColor" strokeLinecap="round" strokeDasharray={`${(review.score / 100) * circumference} ${circumference}`} />
          ) : null}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none text-foreground">{scored ? review.score : '–'}</span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">AI score</p>
        <p className={cn('text-sm font-semibold', band?.tone || 'text-muted-foreground')}>{band ? band.label : 'Not scored yet'}</p>
        <p className={cn('mt-1 flex items-center gap-1.5 text-xs font-medium', recommendation?.tone || 'text-foreground')}>
          <Sparkles className="size-3" aria-hidden="true" />
          {recommendation?.label || 'No recommendation'}
          <span className="font-normal capitalize text-muted-foreground">, {review.riskLevel} risk</span>
        </p>
        {!scored ? <p className="mt-1 text-[11px] text-muted-foreground">Run the review again to score this case.</p> : null}
      </div>
    </div>
  )
}

const OVERVIEW_TONES = { high: 'text-destructive', medium: 'text-warning', low: 'text-muted-foreground', unknown: 'text-warning' }
const OVERVIEW_LIMIT = 3

/** The few most serious points from one source, one line each, and a way into the detail. */
function Overview({ icon, title, items, empty, extra, onMore }) {
  const shown = items.slice(0, OVERVIEW_LIMIT)
  const hidden = items.length - shown.length
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <SubHeading icon={icon} aside={items.length ? `${items.length} ${items.length === 1 ? 'point' : 'points'}` : null}>
        {title}
      </SubHeading>
      {shown.length ? (
        <ul className="mt-3 space-y-2">
          {shown.map((item) => {
            const Icon = item.tone === 'unknown' ? CircleDashed : AlertTriangle
            return (
              <li key={item.key} className="flex gap-2 text-sm">
                <Icon className={cn('mt-0.5 size-4 shrink-0', OVERVIEW_TONES[item.tone])} aria-hidden="true" />
                <span className="line-clamp-2 text-foreground">{item.text}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          {empty}
        </p>
      )}
      {hidden > 0 || extra ? <p className="mt-2 text-xs text-muted-foreground">{[hidden > 0 ? `${hidden} more` : null, extra].filter(Boolean).join(' · ')}</p> : null}
      <button type="button" onClick={onMore} className="mt-3 self-start text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        View details
      </button>
    </div>
  )
}

function Tile({ label, children }) {
  return (
    <div className="rounded-lg border bg-background/60 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function SubHeading({ icon: Icon, children, aside }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {children}
      </h3>
      {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
    </div>
  )
}

/** The rules' detail line: the actual figure beside the threshold, and where it came from. */
const ruleDetail = (result) =>
  result.operator === 'missing'
    ? result.reason || `${FACTS[result.fact]?.label} isn’t known.`
    : `${FACTS[result.fact]?.label}: ${formatFact(result.fact, result.actual)} (rule: ${describeCondition(result).replace(`${FACTS[result.fact]?.label} `, '')})${result.source ? `. ${result.source}.` : ''}`

/**
 * @param showAi  whether this person sees the AI review (credit staff)
 * @param onOpenDocument  opens one document in the Documents tab
 * @param onOpenDetails   opens the application form (Details tab)
 */
export function CaseSummary({ application, documents: allDocuments, prescreen, zra, showAi, canRerun, onRerun, onOpenDocument, onOpenDetails }) {
  const [busy, setBusy] = useState(false)
  // The detailed report's open tab, or null while it is folded away.
  const [report, setReport] = useState(null)
  const reportRef = useRef(null)
  const [scrollToReport, setScrollToReport] = useState(false)
  const openReport = (tab) => {
    setReport(tab)
    setScrollToReport(true)
  }
  useEffect(() => {
    if (scrollToReport && report) {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setScrollToReport(false)
    }
  }, [scrollToReport, report])
  // Only the copies in force: a document sent again after a request replaces the earlier one here, as in the rules.
  const documents = allDocuments.filter((document) => !document.supersededBy)
  const replacesEarlier = (document) => allDocuments.some((entry) => entry.supersededBy === document.id)
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
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Assessment summary</h2>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Running the policy rules and the AI review…
        </p>
      </section>
    )
  }

  const context = {
    application,
    documents,
    sources: prescreen.facts?._notes?.sources || {},
  }
  const evidence = (result) => evidenceForFact(result.fact, { ...context, source: result.source })
  const fired = prescreen.ruleResults.filter((result) => result.state === 'fired').sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome])
  const unknown = prescreen.ruleResults.filter((result) => result.state === 'not_evaluated')
  const passed = prescreen.ruleResults.filter((result) => result.state === 'passed')

  const review = showAi ? prescreen.aiReview : null
  // A flag that only restates a rule that fired adds nothing beside it.
  const ruleMessages = new Set(fired.map((result) => result.message.trim().toLowerCase()))
  const flags = [...(review?.flags || [])].filter((flag) => !ruleMessages.has(String(flag.detail).trim().toLowerCase())).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  // A flag's refs (D1, D2…) are the documents the review was given, in its documentFindings.
  const flagEvidence = (flag) =>
    [...new Set(flag.documents || [])].flatMap((ref) => {
      const finding = review.documentFindings?.find((entry) => entry.ref === ref)
      const document = finding?.documentId && documents.find((entry) => entry.id === finding.documentId)
      if (document) return [{ kind: 'document', document }]
      return finding ? [{ kind: 'missing', label: finding.slot || finding.docType }] : []
    })

  const checked = documents.map((document) => ({
    document,
    ...documentProblems(application, document),
  }))
  const withFindings = checked.filter((entry) => entry.problems.length || entry.tampering.length)
  const unchecked = documents.filter(DOCUMENT_TESTS.documents_unchecked)
  // Each document figure the rules used, under the document it was read from.
  const figuresFrom = (document) =>
    Object.entries(FROM_DOCUMENT)
      .filter(([fact, docType]) => docType === document.docType && prescreen.facts?.[fact] != null && !context.sources[fact]?.startsWith('Entered by'))
      .map(([fact]) => `${FACTS[fact].label}: ${formatFact(fact, prescreen.facts[fact])}`)

  return (
    <section className="rounded-xl border bg-card" aria-labelledby="case-summary-title">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 id="case-summary-title" className="text-sm font-semibold text-foreground">
            Assessment summary
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Policy rules version {prescreen.rulesetVersion}, run {timeAgo(prescreen.updatedAt)}
            {review ? `. AI review${review.sample ? ' (sample data)' : ''} is advisory: the rules and your judgement decide.` : '.'}
          </p>
        </div>
        {canRerun ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={rerun} disabled={busy} title="Run the current rules and the AI review again">
            <RefreshCw className={cn(busy && 'animate-spin')} />
            <span className="sr-only sm:not-sr-only">Run again</span>
          </Button>
        ) : null}
      </div>

      <div className="space-y-5 p-5">
        <div className={cn('grid gap-3', review ? 'sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'sm:grid-cols-2')}>
          {review ? <ScoreCard review={review} /> : null}
          <div className={cn('grid gap-3', review ? 'grid-cols-2' : 'col-span-full sm:grid-cols-2')}>
            <Tile label="Policy rules">
              <OutcomeMark outcome={prescreen.outcome} className="text-sm" />
              <p className="mt-1 text-xs text-muted-foreground">
                {fired.length} {fired.length === 1 ? 'concern' : 'concerns'}, {passed.length} passed
                {unknown.length ? `, ${unknown.length} couldn’t be checked` : ''}
              </p>
            </Tile>
            <Tile label="Documents">
              <p className={cn('text-sm font-medium', withFindings.length ? 'text-warning' : 'text-success')}>
                {withFindings.length ? `${withFindings.length} of ${documents.length} with findings` : documents.length ? 'No findings' : 'None uploaded'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {documents.length - unchecked.length} checked automatically
                {unchecked.length ? `, ${unchecked.length} not checked` : ''}
              </p>
            </Tile>
          </div>
        </div>
        {review?.summary ? <p className="text-sm leading-relaxed text-foreground">{review.summary}</p> : null}
        {showAi && !review && prescreen.aiError ? <p className="text-sm text-muted-foreground">The AI review couldn’t run for this application. The policy rules still apply.</p> : null}

        <div className={cn('grid gap-4', review && 'lg:grid-cols-2')}>
          <Overview
            icon={ClipboardList}
            title="Policy rules"
            empty="No rule raised a concern."
            items={[
              ...fired.map((result) => ({
                key: result.id,
                text: result.message,
                tone: result.outcome === 'decline' ? 'high' : result.outcome === 'refer' ? 'medium' : 'low',
              })),
              ...unknown.map((result) => ({
                key: result.id,
                text: `Couldn’t check: ${describeCondition(result)}`,
                tone: 'unknown',
              })),
            ]}
            onMore={() => openReport('rules')}
          />
          {review ? (
            <Overview
              icon={Sparkles}
              title="AI review"
              empty="The AI raised no flags."
              items={flags.map((flag, index) => ({
                key: `${flag.category}-${index}`,
                text: flag.detail,
                tone: flag.severity,
              }))}
              extra={review.missingInformation?.length ? `${review.missingInformation.length} ${review.missingInformation.length === 1 ? 'piece' : 'pieces'} of information missing` : null}
              onMore={() => openReport('ai')}
            />
          ) : null}
        </div>

        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => setReport(report ? null : 'rules')}
            aria-expanded={Boolean(report)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2">
              <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
              Detailed report
              <span className="text-xs font-normal text-muted-foreground">every rule, flag and document check, with its evidence</span>
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', report && 'rotate-180')} aria-hidden="true" />
          </button>
          {report ? (
            <div ref={reportRef} className="scroll-mt-4 space-y-4 border-t p-4">
              <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Detailed report">
                {[['rules', `Policy rules (${prescreen.ruleResults.length})`], ...(review ? [['ai', `AI review (${flags.length})`]] : []), ['documents', `Documents (${documents.length})`]].map(
                  ([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={report === key}
                      onClick={() => setReport(key)}
                      className={cn(
                        '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                        report === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
              {report === 'rules' ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <SubHeading icon={ClipboardList}>Policy rules</SubHeading>
                  {fired.length ? (
                    <ul className="space-y-3">
                      {fired.map((result) => (
                        <li key={result.id} className="flex gap-2.5 text-sm">
                          <AlertTriangle
                            className={cn('mt-0.5 size-4 shrink-0', result.outcome === 'decline' ? 'text-destructive' : result.outcome === 'refer' ? 'text-warning' : 'text-muted-foreground')}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="text-foreground">{result.message}</p>
                            <p className="text-xs text-muted-foreground">
                              {OUTCOMES[result.outcome].label}. {ruleDetail(result)}
                            </p>
                            <Evidence items={evidence(result)} onOpenDocument={onOpenDocument} onOpenDetails={onOpenDetails} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No rule raised a concern.</p>
                  )}
                  {unknown.length ? (
                    <ul className="space-y-3">
                      {unknown.map((result) => (
                        <li key={result.id} className="flex gap-2.5 text-sm">
                          <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-foreground">Couldn’t check: {describeCondition(result)}</p>
                            <p className="text-xs text-muted-foreground">{result.reason || `${FACTS[result.fact]?.label || 'This figure'} isn’t known for this application.`}</p>
                            <Evidence items={evidence(result)} onOpenDocument={onOpenDocument} onOpenDetails={onOpenDetails} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {passed.length ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">{passed.length} passed</summary>
                      <ul className="mt-2 space-y-2.5">
                        {passed.map((result) => (
                          <li key={result.id} className="flex gap-2 text-xs">
                            <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-muted-foreground">
                                {FACTS[result.fact]?.label}: <span className="text-foreground">{formatFact(result.fact, result.actual)}</span>
                                {result.source ? `. ${result.source}.` : ''}
                              </p>
                              <Evidence items={evidence(result)} onOpenDocument={onOpenDocument} onOpenDetails={onOpenDetails} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {report === 'ai' && review ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <SubHeading icon={Sparkles} aside={review.model ? `${review.model}, ${timeAgo(review.generatedAt || prescreen.updatedAt)}` : null}>
                    AI review
                  </SubHeading>
                  {flags.length ? (
                    <ul className="space-y-3">
                      {flags.map((flag, index) => (
                        <li key={`${flag.category}-${index}`} className="flex gap-2.5 text-sm">
                          <AlertTriangle
                            className={cn('mt-0.5 size-4 shrink-0', flag.severity === 'high' ? 'text-destructive' : flag.severity === 'medium' ? 'text-warning' : 'text-muted-foreground')}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="text-foreground">{flag.detail}</p>
                            <p className="text-xs capitalize text-muted-foreground">
                              {CATEGORIES[flag.category] || flag.category}, {flag.severity} severity
                            </p>
                            <Evidence items={flagEvidence(flag)} onOpenDocument={onOpenDocument} onOpenDetails={onOpenDetails} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">The AI raised no flags.</p>
                  )}
                  {review.missingInformation?.length ? (
                    <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                      <p className="text-xs font-medium text-foreground">Missing information</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {review.missingInformation.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {report === 'documents' ? (
                <div className="space-y-3">
                  <SubHeading icon={FileText} aside="Select one to open it">
                    Document checks
                  </SubHeading>
                  {documents.length ? (
                    <ul className="divide-y rounded-lg border">
                      {checked.map(({ document, problems, tampering }) => {
                        const analysis = document.aiAnalysis
                        const figures = figuresFrom(document)
                        const Icon = !analysis ? CircleDashed : tampering.length ? ShieldAlert : problems.length ? AlertTriangle : CheckCircle2
                        const tone = !analysis ? 'text-muted-foreground' : tampering.length ? 'text-destructive' : problems.length ? 'text-warning' : 'text-success'
                        return (
                          <li key={document.id}>
                            <button
                              type="button"
                              onClick={() => onOpenDocument(document.id)}
                              className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="font-medium text-foreground">{document.label}</span>
                                  <span className="truncate text-xs text-muted-foreground">{document.filename}</span>
                                  {replacesEarlier(document) ? (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">New copy, {timeAgo(document.createdAt)}</span>
                                  ) : null}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {analysis
                                    ? `Read as ${analysis.detectedType || 'unknown'}, ${analysis.legibility === 'clear' ? 'clear' : analysis.legibility === 'partly_legible' ? 'partly legible' : 'hard to read'}${analysis.sample ? ' (sample data)' : ''}`
                                    : CHECKABLE(document)
                                      ? 'Not checked automatically: check it by hand.'
                                      : 'Photo: not checked automatically.'}
                                </span>
                                {tampering.length ? <span className="mt-1 block text-xs text-destructive">Possible tampering: {tampering.join('; ')}</span> : null}
                                {problems.length ? (
                                  <span className="mt-1 block space-y-0.5">
                                    {problems.map((problem) => (
                                      <span key={problem} className="block text-xs text-foreground">
                                        {problem}
                                      </span>
                                    ))}
                                  </span>
                                ) : analysis ? (
                                  <span className="mt-1 block text-xs text-success">Matches what was asked for and agrees with the form.</span>
                                ) : null}
                                {figures.length ? <span className="mt-1 block text-xs text-muted-foreground">Used by the rules: {figures.join('; ')}</span> : null}
                              </span>
                              <span className="shrink-0 text-xs font-medium text-primary">Open</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No documents were uploaded.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* The bureau report has its own panel on this tab; the ZRA check is shown here. */}
        {zra ? (
          <p className="flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            ZRA taxpayer check:{' '}
            <span className="font-medium text-foreground">
              {{
                verified: 'verified',
                mismatch: 'record differs',
                not_found: 'not found',
                unavailable: 'didn’t run',
              }[zra.status] || zra.status}
            </span>
            {zra.at ? `, ${timeAgo(zra.at)}` : ''}
          </p>
        ) : null}
      </div>
    </section>
  )
}
