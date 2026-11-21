import React, { useState } from 'react'
import { ArrowRight, ScanFace, ShieldCheck, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DRAFT_RETENTION_DAYS, formatKwacha, priceLoan } from '@/config/loanProducts'
import { useProduct, useProductCatalog } from '@/hooks/useProducts'
import { offeredLoanTypes } from '@/components/landing/LoanProducts'
import heroImage from '@/assets/hero1.png'

const ASSURANCES = [
  { icon: Save, label: `Progress saved for ${DRAFT_RETENTION_DAYS} days` },
  { icon: ShieldCheck, label: 'Resume by email verification' },
  { icon: ScanFace, label: 'Identity check runs on your device' },
]

export function Hero({ onChooseType, onMyApplication }) {
  const personal = useProduct('personal')
  const business = useProduct('business')
  // Choosing who borrows opens the loan finder on that type (LoanProducts): a button for each of the first two offered.
  const catalog = useProductCatalog()
  const typeButtons = offeredLoanTypes(catalog.loanTypes, catalog.products).slice(0, 2)
  // The repayment calculator: the visitor's own amount and loan length, priced as the wizard prices them.
  const [chosenAmount, setChosenAmount] = useState(null)
  const [chosenTenure, setChosenTenure] = useState(null)
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
  const amountStep = personal.maxAmount - personal.minAmount >= 20000 ? 500 : 100
  const amount = clamp(chosenAmount ?? personal.exampleAmount, personal.minAmount, personal.maxAmount)
  const tenure = clamp(chosenTenure ?? personal.defaultTenure, personal.minTenure, personal.maxTenure)
  const price = priceLoan(amount, tenure, personal)

  return (
    <section id="top" className="relative overflow-hidden border-b border-border">
      {/* Decorative wash — kept behind content and hidden from assistive tech. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-24 -top-32 size-[34rem] rounded-full bg-accent blur-3xl" />
        <div className="absolute -left-40 bottom-0 size-[26rem] rounded-full bg-secondary blur-3xl" />
      </div>

      <div className="container grid items-center gap-12 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="max-w-xl">
          <Badge variant="accent">Personal &amp; business lending · Zambia</Badge>

          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]">
            Apply for a loan, <span className="text-primary">start to finish</span>, online.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
            Personal loans from {formatKwacha(personal.minAmount)} to {formatKwacha(personal.maxAmount)}, and business
            loans up to {formatKwacha(business.maxAmount)}. Work through the form at your own pace — everything you
            enter is saved as you go, so you can stop on your phone and finish on a laptop.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {typeButtons.map((type, index) => (
              <Button key={type.key} size="lg" variant={index === 0 ? 'default' : 'outline'} className="sm:flex-1" onClick={() => onChooseType(type.key)}>
                Find {type.label.toLowerCase()}
                {index === 0 ? <ArrowRight /> : null}
              </Button>
            ))}
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Already applied?{' '}
            <button
              type="button"
              onClick={onMyApplication}
              className="rounded font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Finish or track your application
            </button>
          </p>

          <ul className="mt-10 grid gap-3 border-t border-border pt-8 sm:grid-cols-3">
            {ASSURANCES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-br from-accent via-secondary to-background ring-1 ring-border">
            <img
              src={heroImage}
              alt="An applicant completing a loan application on a laptop"
              className="absolute inset-x-0 bottom-0 mx-auto w-[92%] object-contain"
              loading="eager"
              decoding="async"
              width={827}
              height={719}
            />
          </div>

          {/* Repayment calculator, priced with the same constants the wizard uses. */}
          <div className="relative mx-auto -mt-20 w-[min(23rem,92%)] rounded-lg border bg-card p-5 shadow-lift lg:absolute lg:-bottom-6 lg:-left-6 lg:mx-0 lg:mt-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Repayment calculator · {personal.name}</p>

            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <label htmlFor="calc-amount" className="text-muted-foreground">Borrow</label>
                  <span className="font-semibold tabular-nums text-foreground">{formatKwacha(amount)}</span>
                </div>
                <input
                  id="calc-amount"
                  type="range"
                  min={personal.minAmount}
                  max={personal.maxAmount}
                  step={amountStep}
                  value={amount}
                  onChange={(event) => setChosenAmount(Number(event.target.value))}
                  aria-valuetext={formatKwacha(amount)}
                  className="mt-1.5 w-full accent-[hsl(var(--primary))]"
                />
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <label htmlFor="calc-tenure" className="text-muted-foreground">Pay back over</label>
                  <span className="font-semibold tabular-nums text-foreground">
                    {tenure} {tenure === 1 ? 'month' : 'months'}
                  </span>
                </div>
                <input
                  id="calc-tenure"
                  type="range"
                  min={personal.minTenure}
                  max={personal.maxTenure}
                  step={1}
                  value={tenure}
                  onChange={(event) => setChosenTenure(Number(event.target.value))}
                  aria-valuetext={`${tenure} months`}
                  className="mt-1.5 w-full accent-[hsl(var(--primary))]"
                />
              </div>
            </div>

            <p className="mt-4 text-3xl font-bold tracking-tight text-foreground" aria-live="polite">
              {formatKwacha(Math.round(price.monthly))}
              <span className="ml-1.5 text-sm font-medium text-muted-foreground">/ month</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatKwacha(Math.round(price.total))} total, including the one-off fee. An estimate — your exact figure is shown before you submit.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
