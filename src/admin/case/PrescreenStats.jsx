import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, Gauge, HandCoins, Percent, Scale, Wallet } from 'lucide-react'

import { cn } from '@/lib/utils'
import { eligibilityFor } from '@/config/eligibility'
import { monthlyEquivalent } from '@/config/loanTerms'
import { money } from '../components'

/**
 * Pre-screening at a glance: the figures an officer screens a new application on, in one row
 * of cards — what comes in, what already goes out, the repayments against the income, the
 * credit bureau, what was asked for against what they can afford, and what the policy rules
 * made of it. Shown only while the case is at the workflow's first stage (Pre-screening);
 * everything here is worked out from the prescreen and the application, nothing is stored.
 */


const TONES = {
  success: { text: 'text-success', bg: 'bg-success/10', bar: 'bg-success' },
  warning: { text: 'text-warning', bg: 'bg-warning/10', bar: 'bg-warning' },
  destructive: {
    text: 'text-destructive',
    bg: 'bg-destructive/10',
    bar: 'bg-destructive',
  },
  muted: {
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    bar: 'bg-muted-foreground',
  },
}

const percent = (ratio) => `${Math.round(ratio * 100)}%`

function Pill({ tone, children }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone].bg, TONES[tone].text)}>{children}</span>
}

/** One figure's card. `collapsible` ones start folded: the header (with its badge) shows, the detail on a click. */
function Card({ icon: Icon, title, badge, collapsible = false, children }) {
  const [open, setOpen] = useState(!collapsible)
  const heading = (
    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {collapsible ? <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden="true" /> : null}
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      {title}
    </span>
  )
  return (
    <section className={cn('flex flex-col rounded-xl border bg-card', !open && 'self-start')}>
      <div className={cn('flex items-center justify-between gap-3 px-4 py-3', open && 'border-b')}>
        {collapsible ? (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {heading}
          </button>
        ) : (
          <h3>{heading}</h3>
        )}
        {badge}
      </div>
      {open ? <div className="flex-1 space-y-3 p-4">{children}</div> : null}
    </section>
  )
}

function Rows({ rows }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined)
  if (!shown.length) return null
  return (
    <dl className="divide-y text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Big({ value, unit, tone = null }) {
  return (
    <p className={cn('text-2xl font-semibold tabular-nums', tone ? TONES[tone].text : 'text-foreground')}>
      {value}
      {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
    </p>
  )
}

/** A share against its limit: the bar fills to the share, the tick marks the limit. */
function Meter({ ratio, limit, tone }) {
  const scale = Math.max(limit * 1.5, ratio, 0.01)
  return (
    <div className="relative h-2 rounded-full bg-muted" aria-hidden="true">
      <div className={cn('h-2 rounded-full', TONES[tone].bar)} style={{ width: `${Math.min(100, (ratio / scale) * 100)}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/70" style={{ left: `${(limit / scale) * 100}%` }} />
    </div>
  )
}

export function PrescreenStats({ application, product, prescreen, crbReports, affordability = null }) {
  const facts = prescreen?.facts || {}
  const sources = facts._notes?.sources || {}
  const personal = application.loanType === 'personal'
  const qualified = application.data?.eligibility || {}

  // Income: what the documents show first (payslip net pay, or a business's bank credits), else what was stated.
  const documentIncome = personal ? facts.net_monthly_pay : facts.average_monthly_credits
  const statedIncome = qualified.income ?? facts.stated_income ?? null
  const income = documentIncome ?? statedIncome
  const incomeSource =
    documentIncome != null ? sources[personal ? 'net_monthly_pay' : 'average_monthly_credits'] || 'From the documents' : statedIncome != null ? 'Stated by the applicant, not yet checked' : null

  // What already goes out each month, and this loan's instalment on top.
  const commitments = Number(qualified.commitments) || 0
  // Appraised terms may repay weekly or quarterly: affordability compares a monthly figure.
  const instalment = Number(application.terms ? monthlyEquivalent(application.terms) : application.monthlyInstalment) || 0
  const outgoing = commitments + instalment

  // All repayments against the income, set against the share of income the product allows.
  const limit = product?.eligibility?.repaymentShare ?? qualified.repaymentShare ?? (personal ? 0.4 : 0.3)
  const ratio = income ? outgoing / income : null
  const ratioTone = ratio == null ? 'muted' : ratio <= limit ? 'success' : ratio <= limit * 1.25 ? 'warning' : 'destructive'
  // The policy rule on this loan's instalment alone (Policy rules), if it was checked.
  const instalmentRule = (prescreen?.ruleResults || []).find((result) => result.fact === (personal ? 'debt_to_income' : 'instalment_to_credits') && ['gt', 'gte'].includes(result.operator))

  // What they can afford on that income, against what they asked for.
  const afford = product && income ? eligibilityFor(product, { income, commitments }) : null
  const maxAmount = afford?.maxAmount ?? qualified.maxAmount ?? null
  const requestedShare = maxAmount ? application.amount / maxAmount : null
  const over = maxAmount != null && application.amount > maxAmount

  // The credit bureau: the latest report, else the score the rules saw.
  const report = crbReports?.[0]
  const score = report?.score ?? facts.crb_score ?? null

  return (
    <section aria-labelledby="prescreen-stats" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="prescreen-stats" className="text-sm font-semibold text-foreground">
          Pre-screening at a glance
        </h2>
        <p className="text-xs text-muted-foreground">Worked out from the application and its documents.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card icon={Wallet} title={personal ? 'Income' : 'Monthly revenue'}>
          <Big value={income != null ? money(income) : 'Unknown'} unit={income != null ? '/ month' : null} tone={income == null ? 'warning' : null} />
          {incomeSource ? <p className="text-xs text-muted-foreground">{incomeSource}</p> : <p className="text-xs text-warning">Not read from the documents and not stated.</p>}
          <Rows
            rows={[
              [personal ? 'Net pay (payslip)' : 'Bank credits a month', documentIncome != null ? money(documentIncome) : null],
              ['Stated when applying', statedIncome != null ? money(statedIncome) : null],
              [
                personal ? 'Bank credits a month' : 'Annual turnover (tax return)',
                personal ? (facts.average_monthly_credits != null ? money(facts.average_monthly_credits) : null) : facts.annual_turnover != null ? money(facts.annual_turnover) : null,
              ],
            ]}
          />
        </Card>

        <Card icon={Percent} title="Repayments ÷ income" badge={ratio == null ? null : <Pill tone={ratioTone}>{ratio <= limit ? 'Within limit' : 'Over limit'}</Pill>}>
          <Big value={ratio == null ? '—' : percent(ratio)} tone={ratio == null ? null : ratioTone} />
          {ratio == null ? (
            <p className="text-xs text-muted-foreground">Needs the income to work out.</p>
          ) : (
            <>
              <Meter ratio={ratio} limit={limit} tone={ratioTone} />
              <p className="flex justify-between text-xs text-muted-foreground">
                <span>All repayments, this loan included</span>
                <span>Product limit {percent(limit)}</span>
              </p>
            </>
          )}
          <Rows
            rows={[
              ['Repayments a month', money(outgoing)],
              [
                personal ? 'This loan alone ÷ net pay' : 'This loan alone ÷ bank credits',
                instalmentRule?.actual != null ? `${percent(instalmentRule.actual)} (policy ${percent(instalmentRule.value)})` : null,
              ],
            ]}
          />
        </Card>

        <Card icon={Gauge} title="Credit bureau" badge={report?.report?.band ? <Pill tone="muted">{report.report.band}</Pill> : null}>
          <Big value={score ?? '—'} />
          <p className="text-xs text-muted-foreground">
            {report
              ? `${report.report?.sample ? 'Sample report' : 'Latest report'}${report.report?.summary ? ` · ${report.report.summary}` : ''}`
              : score != null
                ? 'Score the rules ran on · no report on file'
                : 'No credit report yet.'}
          </p>
        </Card>

        <Card icon={HandCoins} title="Existing repayments" collapsible>
          <Big value={money(commitments)} unit="/ month" />
          <p className="text-xs text-muted-foreground">{commitments ? 'Other loan repayments the applicant declared' : 'The applicant declared no other loan repayments'}</p>
          <Rows
            rows={[
              ['Other loans', money(commitments)],
              ['This loan’s instalment', money(instalment)],
              ['Total a month', money(outgoing)],
            ]}
          />
        </Card>

        <Card icon={Scale} title="Requested vs affordable" collapsible badge={maxAmount == null ? null : <Pill tone={over ? 'warning' : 'success'}>{over ? 'Over limit' : 'Affordable'}</Pill>}>
          <Rows
            rows={[
              ['Requested', `${money(application.amount)} over ${application.tenure} months`],
              ['Can afford up to', maxAmount != null ? money(maxAmount) : 'Unknown'],
              ['Requested ÷ affordable', requestedShare != null ? percent(requestedShare) : null],
            ]}
          />
          {over ? (
            <p className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {money(application.amount - maxAmount)} more than the {personal ? 'net pay' : 'revenue'} supports at {percent(limit)} of income.
            </p>
          ) : null}
        </Card>

        {/* Affordability: the figures the rules use, and where staff enter the missing ones. */}
        {affordability}
      </div>
    </section>
  )
}
