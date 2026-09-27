import React from 'react'
import { CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Confirmation after submit, carrying the reference the applicant quotes from now on. */
function SuccessModal({ open, onClose, loanType, amount, tenure, monthlyRepayment, totalRepayable, reference, assisted }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4" role="dialog" aria-modal="true" aria-labelledby="success-title">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 text-card-foreground shadow-lift">
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
          <h2 id="success-title" className="mt-3 text-2xl font-semibold tracking-tight">
            Application submitted
          </h2>
          {reference ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Reference <span className="font-semibold tracking-wide text-foreground">{reference}</span>
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {assisted
              ? 'The customer will get updates by email. It’s now in the loan officers’ queue.'
              : 'We’ll email you when there’s news. You can follow it any time from “My applications”.'}
          </p>
        </div>

        <dl className="mt-6 divide-y rounded-xl border bg-muted/30 px-4 text-sm">
          {[
            ['Loan', loanType === 'personal' ? 'Personal loan' : 'Business loan'],
            ['Amount', `K${amount.toLocaleString()}`],
            ['Tenure', `${tenure} months`],
            ['Estimated monthly repayment', `K${monthlyRepayment.toFixed(2)}`],
            ['Total repayable', `K${totalRepayable.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex justify-center">
          <Button type="button" onClick={onClose}>
            {assisted ? 'Open the case' : 'Follow my application'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default SuccessModal
