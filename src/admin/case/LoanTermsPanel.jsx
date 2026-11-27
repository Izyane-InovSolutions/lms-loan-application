import React, { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2, Plus, Save, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CALCULATIONS, CHARGE_NAMES, FREQUENCIES, INTEREST_TYPES, chargeAmount, checkTerms, defaultTerms, scheduleFor, summarizeTerms } from '@/config/loanTerms'
import { Field, FormError, Panel, dateTime, money } from '../components'

/*
 * The case's Loan terms tab (src/config/loanTerms.js): what the appraiser structures at the
 * terms stage (amount, tenure, frequency, rate, calculation, charges), the summary those terms
 * give and their repayment schedule. Editable only at that stage, by whoever works the case
 * there; read-only before and after. Saving posts the `save_terms` action.
 */

const kwacha = (value) => `K${Number(value || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const longDate = (value) => {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// The form keeps what is typed (strings); checkTerms coerces it.
const formOf = (terms) => ({
  amount: String(terms.amount ?? ''),
  tenure: String(terms.tenure ?? ''),
  frequency: terms.frequency || 'monthly',
  annualRate: String(terms.annualRate ?? ''),
  interestType: terms.interestType || 'fixed',
  calculation: terms.calculation || 'flat',
  effectiveDate: terms.effectiveDate || '',
  charges: (terms.charges || []).map((charge) => ({ name: charge.name || '', type: charge.type || 'fixed', value: String(charge.value ?? '') })),
})

const termsOf = (form) => ({
  amount: form.amount,
  tenure: form.tenure,
  frequency: form.frequency,
  annualRate: form.annualRate,
  interestType: form.interestType,
  calculation: form.calculation,
  effectiveDate: form.effectiveDate,
  charges: form.charges,
})

export function LoanTermsPanel({ application, product, editable, onSave }) {
  const saved = application.terms
  const start = useMemo(() => (saved ? saved : product ? defaultTerms(product, application) : null), [saved, product, application])
  const [form, setForm] = useState(() => (start ? formOf(start) : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverErrors, setServerErrors] = useState({})
  // A save (or a colleague's, on reload) starts the form again from what is saved.
  const savedAt = saved?.savedAt || null
  useEffect(() => {
    if (start) setForm(formOf(start))
    setServerErrors({})
    // Only when what is saved changes, not on every reload of the case.
  }, [savedAt, application.id])

  if (!product || !form) {
    return (
      <Panel title="Loan terms">
        <p className="text-sm text-muted-foreground">This case has no loan product, so there are no terms to set.</p>
      </Panel>
    )
  }
  if (!saved && !editable) {
    return (
      <Panel title="Loan terms" description="Set at the appraisal stage.">
        <p className="text-sm text-muted-foreground">No terms have been saved yet.</p>
      </Panel>
    )
  }

  const { terms, errors: localErrors } = checkTerms(termsOf(form), product)
  const errors = { ...serverErrors, ...localErrors }
  const valid = !Object.keys(localErrors).length
  const summary = valid ? summarizeTerms(terms) : null
  const rows = valid ? scheduleFor(terms, saved?.paidOutOn && !editable ? saved.paidOutOn : terms.effectiveDate) : []
  const dirty = !saved || JSON.stringify(formOf(saved)) !== JSON.stringify(form)

  const set = (key) => (event) => {
    const { value } = event.target
    setForm((prev) => ({ ...prev, [key]: value }))
    setServerErrors((prev) => ({ ...prev, [key]: undefined }))
  }
  const setCharge = (index, key) => (event) => {
    const { value } = event.target
    setForm((prev) => ({ ...prev, charges: prev.charges.map((charge, at) => (at === index ? { ...charge, [key]: value } : charge)) }))
  }
  const addCharge = () => setForm((prev) => ({ ...prev, charges: [...prev.charges, { name: '', type: 'fixed', value: '' }] }))
  const removeCharge = (index) => setForm((prev) => ({ ...prev, charges: prev.charges.filter((_, at) => at !== index) }))

  const save = async (event) => {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      await onSave(terms)
    } catch (saveError) {
      setError(saveError.message)
      if (saveError.errors) setServerErrors(saveError.errors)
    } finally {
      setBusy(false)
    }
  }

  const eligible = application.data?.eligibility?.maxAmount
  const frequencyLabel = (FREQUENCIES[form.frequency]?.label || form.frequency).toLowerCase()

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      {/* The summary stays in view while the terms are edited, within this row only: it never slides over the schedule. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <Panel title="Final loan terms" description={editable ? 'What the loan will be, within the product’s limits.' : 'As saved at appraisal.'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Fact label="Requested" hint="At application" value={`${money(application.amount)} over ${application.tenure} months`} />
            <TermField
              id="terms-amount"
              label="Approved amount (K)"
              hint={eligible ? `Eligibility: ${money(eligible)}` : `This product lends ${money(product.minAmount)} to ${money(product.maxAmount)}`}
              error={errors.amount}
              editable={editable}
              view={money(terms.amount)}
            >
              <Input id="terms-amount" type="number" inputMode="decimal" min={product.minAmount} max={product.maxAmount} value={form.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} />
            </TermField>
            <TermField id="terms-tenure" label="Tenure (months)" error={errors.tenure} editable={editable} view={`${terms.tenure} months`}>
              <Input id="terms-tenure" type="number" inputMode="numeric" min={product.minTenure} max={product.maxTenure} value={form.tenure} onChange={set('tenure')} aria-invalid={Boolean(errors.tenure)} />
            </TermField>
            <TermField id="terms-frequency" label="Repayment frequency" error={errors.frequency} editable={editable} view={FREQUENCIES[terms.frequency]?.label}>
              <Select id="terms-frequency" value={form.frequency} onChange={set('frequency')}>
                {Object.entries(FREQUENCIES).map(([key, entry]) => (
                  <option key={key} value={key}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </TermField>
          </div>
        </Panel>

        <Panel title="Interest rate & calculation method">
          <div className="grid gap-4 sm:grid-cols-2">
            <TermField id="terms-rate" label="Interest rate (% a year)" error={errors.annualRate} editable={editable} view={`${terms.annualRate}% a year`}>
              <Input id="terms-rate" type="number" inputMode="decimal" step="0.01" min="0.1" max="300" value={form.annualRate} onChange={set('annualRate')} aria-invalid={Boolean(errors.annualRate)} />
            </TermField>
            <TermField id="terms-type" label="Interest type" error={errors.interestType} editable={editable} view={INTEREST_TYPES[terms.interestType]}>
              <Select id="terms-type" value={form.interestType} onChange={set('interestType')}>
                {Object.entries(INTEREST_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </TermField>
            <TermField id="terms-calculation" label="Calculation method" error={errors.calculation} editable={editable} view={CALCULATIONS[terms.calculation]}>
              <Select id="terms-calculation" value={form.calculation} onChange={set('calculation')}>
                {Object.entries(CALCULATIONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </TermField>
            <TermField
              id="terms-effective"
              label="Effective date"
              hint="The first instalment falls one period after it."
              error={errors.effectiveDate}
              editable={editable}
              view={longDate(terms.effectiveDate)}
            >
              <Input id="terms-effective" type="date" value={form.effectiveDate} onChange={set('effectiveDate')} aria-invalid={Boolean(errors.effectiveDate)} />
            </TermField>
          </div>
        </Panel>

        <Panel
          title="Fees & charges"
          description="Paid upfront: taken off the amount paid out, not added to the instalments."
          action={
            editable ? (
              <Button type="button" variant="outline" size="sm" onClick={addCharge}>
                <Plus />
                Add charge
              </Button>
            ) : null
          }
        >
          {form.charges.length ? (
            <ul className="space-y-3">
              {form.charges.map((charge, index) =>
                editable ? (
                  <li key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem_auto] sm:items-end sm:border-0 sm:p-0">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Name
                      <Input list="terms-charge-names" value={charge.name} onChange={setCharge(index, 'name')} placeholder="Choose or type a name" className="h-9 text-sm" />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Charged as
                      <Select value={charge.type} onChange={setCharge(index, 'type')} className="h-9 text-sm">
                        <option value="fixed">Fixed (K)</option>
                        <option value="percent">% of amount</option>
                      </Select>
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      {charge.type === 'percent' ? 'Percent' : 'Amount (K)'}
                      <Input type="number" inputMode="decimal" min="0" step="0.01" value={charge.value} onChange={setCharge(index, 'value')} className="h-9 text-sm" />
                    </label>
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="text-xs tabular-nums text-muted-foreground sm:hidden">{Number(form.amount) > 0 ? kwacha(chargeAmount(charge, form.amount)) : null}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => removeCharge(index)} aria-label={`Remove ${charge.name || 'this charge'}`}>
                        <X />
                        <span className="sm:sr-only">Remove</span>
                      </Button>
                    </div>
                  </li>
                ) : (
                  <li key={index} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">
                      {charge.name}
                      {charge.type === 'percent' ? <span className="text-muted-foreground"> ({charge.value}% of the amount)</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">{kwacha(chargeAmount(charge, terms.amount))}</span>
                  </li>
                )
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No charges.</p>
          )}
          <datalist id="terms-charge-names">
            {CHARGE_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {errors.charges ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {errors.charges}
            </p>
          ) : null}
        </Panel>

        {editable ? (
          <div className="space-y-3">
            <FormError message={error} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || !valid || !dirty}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                Save terms
              </Button>
              <p className="text-xs text-muted-foreground">
                {!valid ? 'Fix the highlighted fields first.' : dirty ? (saved ? 'You have unsaved changes.' : 'Not saved yet. The stage moves on once the terms are saved.') : 'Saved.'}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <Panel title="Summary of terms" description={saved?.savedByName ? `Saved by ${saved.savedByName}, ${dateTime(saved.savedAt)}` : undefined}>
          {summary ? (
            <dl className="space-y-2 text-sm">
              <Row label="Approved amount" value={kwacha(terms.amount)} />
              <Row label="Rate" value={`${terms.annualRate}% a year, ${CALCULATIONS[terms.calculation].toLowerCase()}`} />
              <Row label={`Instalment (${frequencyLabel})`} value={kwacha(summary.instalment)} strong />
              <Row label="Instalments" value={summary.periods} />
              <Row label="Total interest" value={kwacha(summary.totalInterest)} />
              <Row label="Total charges" value={kwacha(summary.totalCharges)} />
              <Row label="Paid out" value={kwacha(summary.netDisbursed)} />
              <Row label="Total repayable" value={kwacha(summary.totalRepayable)} strong />
              <Row label="First due" value={longDate(rows[0]?.due)} />
              <Row label="Last due" value={longDate(rows.at(-1)?.due)} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Fix the highlighted fields to see the summary.</p>
          )}
        </Panel>
      </div>
      </div>

      <Panel
        className="min-w-0"
        title="Repayment schedule"
        description={saved?.paidOutOn && !editable ? `Due dates from the payout on ${longDate(saved.paidOutOn)}.` : 'Due dates move with the actual payout date.'}
        bodyClassName="p-0"
      >
        {rows.length ? (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-4 py-2 text-left font-medium">No.</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">Due date</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Instalment</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Principal</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Interest</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {rows.map((row) => (
                  <tr key={row.number}>
                    <td className="px-4 py-2 text-muted-foreground">{row.number}</td>
                    <td className="whitespace-nowrap px-4 py-2">{longDate(row.due)}</td>
                    <td className="px-4 py-2 text-right">{kwacha(row.instalment)}</td>
                    <td className="px-4 py-2 text-right">{kwacha(row.principal)}</td>
                    <td className="px-4 py-2 text-right">{kwacha(row.interest)}</td>
                    <td className="px-4 py-2 text-right">{kwacha(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <CalendarClock className="size-4" aria-hidden="true" />
            Fix the highlighted fields to see the schedule.
          </p>
        )}
      </Panel>
    </form>
  )
}

/** A field that is an input while editable, and its value as text otherwise. */
function TermField({ id, label, hint, error, editable, view, children }) {
  if (!editable) return <Fact label={label.replace(/ \((?:K|months|% a year)\)$/, '')} value={view} />
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {children}
    </Field>
  )
}

function Fact({ label, value, hint }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-sm tabular-nums text-foreground">{value ?? '—'}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right tabular-nums text-foreground', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}
