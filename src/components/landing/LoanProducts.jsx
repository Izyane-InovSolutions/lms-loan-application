import React from 'react'
import { ArrowRight, Briefcase, FileSearch, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionHeading } from '@/components/landing/SectionHeading'
import { LoanProductCard } from '@/components/landing/LoanProductCard'
import { useProductCatalog } from '@/hooks/useProducts'
import { cn } from '@/lib/utils'
import { INCOME_LABELS, eligibilityFor, readFigures } from '@/config/eligibility'
import { MATCHING_PREFIX } from '@/config/loanProducts'
import { fromVerdict, usePolicyVerdicts } from '@/hooks/usePolicyVerdicts'

// Each loan type is shown with the icon of the form its applicants fill in.
const FORM_ICONS = { personal: User, business: Briefcase }

/** The loan types applicants can choose: those with at least one product on offer, in the order they are set up. */
export const offeredLoanTypes = (loanTypes, products) => loanTypes.filter((type) => products.some((product) => product.loanType === type.key))

/**
 * Choosing a loan: the loan type first (who borrows), then what they earn, then the
 * products of that type with what each would lend them (src/config/eligibility.js) and whether
 * the policy's income bands allow it (usePolicyVerdicts). Only
 * products they qualify for can be started; the others say why.
 */
export function LoanProducts({ loanType: chosen, onLoanTypeChange, figures, onFiguresChange, onApply }) {
  const catalog = useProductCatalog()
  const types = offeredLoanTypes(catalog.loanTypes, catalog.products)
  const type = types.find((entry) => entry.key === chosen) || types[0]
  const loanType = type?.key
  const products = catalog.products.filter((product) => product.loanType === loanType)
  const words = INCOME_LABELS[type?.form || 'personal']
  const mine = figures[loanType] || {}
  const known = Boolean(readFigures(mine))
  const verdicts = usePolicyVerdicts(loanType, mine)
  const results = products.map((product) => ({ product, eligibility: known && verdicts?.[product.id] ? fromVerdict(verdicts[product.id]) : eligibilityFor(product, mine) }))
  // What they qualify for first, the largest amounts first; then the rest.
  results.sort((a, b) => (b.eligibility.status === 'eligible') - (a.eligibility.status === 'eligible') || (b.eligibility.maxAmount || 0) - (a.eligibility.maxAmount || 0))
  const eligible = results.filter((result) => result.eligibility.status === 'eligible').length
  const set = (field) => (event) => onFiguresChange(loanType, { ...mine, [field]: event.target.value.replace(/[^0-9]/g, '') })
  if (!type) return null

  return (
    <section id="loans" className="scroll-mt-16 border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="Our loans"
          title="Find the loans you qualify for"
          description="Choose who is borrowing, tell us what comes in each month, and we show the loans that fit — and how much each could lend you."
        />

        <div className="mx-auto mt-10 max-w-3xl space-y-5">
          <div role="radiogroup" aria-label="Loan type" className={cn('grid gap-3', types.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {types.map(({ key, label, description, form }) => {
              const Icon = FORM_ICONS[form]
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={loanType === key}
                  onClick={() => onLoanTypeChange(key)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    loanType === key ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/40'
                  )}
                >
                  <span className={cn('grid size-10 place-items-center rounded-md', loanType === key ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-semibold text-foreground">{label}</span>
                    <span className="block text-sm text-muted-foreground">{description}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="grid gap-4 rounded-lg border bg-card p-5 shadow-soft sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qualify-income">{words.label} (K)</Label>
              <Input id="qualify-income" inputMode="numeric" placeholder="e.g. 12000" value={mine.income || ''} onChange={set('income')} />
              <p className="text-xs text-muted-foreground">{words.hint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qualify-commitments">Other loan repayments a month (K)</Label>
              <Input id="qualify-commitments" inputMode="numeric" placeholder="0" value={mine.commitments || ''} onChange={set('commitments')} />
              <p className="text-xs text-muted-foreground">What you already repay on other loans. Leave blank if none.</p>
            </div>
            <p className="text-sm sm:col-span-2" aria-live="polite">
              {!known ? (
                <span className="text-muted-foreground">Enter your {words.short} to see what you qualify for.</span>
              ) : eligible ? (
                <span className="font-medium text-foreground">
                  You qualify for {eligible} of the {products.length} {type.label.toLowerCase()} here.
                </span>
              ) : (
                <span className="font-medium text-foreground">None of our {type.label.toLowerCase()} fit these figures yet. Each one below says why.</span>
              )}{' '}
              <span className="text-muted-foreground">We check these figures against your {type.form === 'personal' ? 'payslips' : 'bank statements'} later.</span>
            </p>
          </div>
        </div>

        {/* The other way in: apply first, and the documents decide (productEligibility.js). */}
        <div className="mx-auto mt-5 flex max-w-3xl flex-col gap-3 rounded-lg border border-dashed bg-card/60 p-5 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <FileSearch className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">Not sure which loan? We’ll match you.</p>
            <p className="text-sm text-muted-foreground">
              Fill in the form and upload your {type.form === 'personal' ? 'payslips and documents' : 'bank statements and documents'}. We read them and show the {type.label.toLowerCase()} you qualify for before you choose.
            </p>
          </div>
          <Button variant="outline" onClick={() => onApply(`${MATCHING_PREFIX}${type.key}`)}>
            Apply and get matched
            <ArrowRight />
          </Button>
        </div>

        {products.length ? (
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {results.map(({ product, eligibility }) => (
              <LoanProductCard key={product.id} product={product} eligibility={eligibility} onApply={onApply} />
            ))}
          </div>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">No loans are offered at the moment.</p>
        )}

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-muted-foreground">
          Total repayable = amount borrowed + interest + a one-off facility fee. Your exact monthly figure is shown on the
          Loan Terms step before you commit to anything.
        </p>
      </div>
    </section>
  )
}
