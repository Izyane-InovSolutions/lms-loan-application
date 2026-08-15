import React from 'react'

import { SectionHeading } from '@/components/landing/SectionHeading'
import { LoanProductCard } from '@/components/landing/LoanProductCard'
import { FACILITY_FEE, INTEREST_RATE, LOAN_PRODUCTS } from '@/config/loanProducts'

export function LoanProducts({ onApply }) {
  return (
    <section id="loans" className="border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="Our loans"
          title="Two products, one straightforward form"
          description="Pick the journey that matches you. Both are priced the same way — a flat interest rate plus a one-off facility fee, with no compounding."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {LOAN_PRODUCTS.map((product) => (
            <LoanProductCard
              key={product.id}
              product={product}
              onApply={onApply}
              featured={product.id === 'personal'}
            />
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-muted-foreground">
          Total repayable = amount borrowed + {INTEREST_RATE * 100}% interest + a one-off K{FACILITY_FEE} facility fee.
          Your exact monthly figure is shown on the Loan Terms step before you commit to anything.
        </p>
      </div>
    </section>
  )
}
