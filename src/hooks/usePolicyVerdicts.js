import React from 'react'

import { matchLoanProducts } from '@/services/applicationsApi'

/**
 * The server's verdict on these figures (POST /match, no documents): the policy rules — the net
 * pay or revenue bands in Policy rules — and affordability. Keyed by product id; null until it
 * answers, and if it can't, the affordability worked out here stands in.
 */
export function usePolicyVerdicts(loanType, figures) {
  const [verdicts, setVerdicts] = React.useState(null)
  const income = figures?.income || ''
  const commitments = figures?.commitments || ''
  React.useEffect(() => {
    setVerdicts(null)
    if (!loanType || !Number(income)) return undefined
    let live = true
    const timer = setTimeout(() => {
      matchLoanProducts(null, { loanType, income, commitments })
        .then((result) => live && setVerdicts(Object.fromEntries(result.products.map((entry) => [entry.id, entry]))))
        .catch(() => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [loanType, income, commitments])
  return verdicts
}

/** A /match verdict in the shape eligibilityFor gives. */
export const fromVerdict = (verdict) => ({ status: verdict.status, budget: verdict.budget, maxAmount: verdict.maxAmount, ...(verdict.reasons.length ? { reason: verdict.reasons[0] } : {}) })
