/**
 * Which loan products an applicant qualifies for, and how much each would lend them, from
 * what they earn. Shared by the website (which shows it before they choose), the wizard
 * (which caps the amount) and the server (which checks it again on submission).
 *
 * The applicant's figures: { income, commitments }, monthly, in kwacha —
 *   income       net monthly pay (personal loans) or average monthly revenue (business)
 *   commitments  what they already repay on other loans each month
 *
 * A product's rule (loanProducts.js DEFAULT_ELIGIBILITY): { minIncome, repaymentShare }.
 * Their monthly budget for this loan is income × repaymentShare − commitments; the largest
 * loan they can afford is the one whose instalment, at the product's longest tenure, fits
 * that budget. Pricing is flat (priceLoan), so the instalment is linear in the amount and
 * the largest amount is solved for directly:
 *
 *   instalment(P) = (P + P·rate·k + fee(P)) / n    k = n when interest is charged monthly, else 1
 *                                                  fee(P) = fixed, or P·share for a percentage fee
 *   P = (budget·n − fixedFee) / (1 + rate·k + feeShare)
 */

import { formatKwacha, priceLoan } from './loanProducts.js'

/** What the income figure is called on each form. */
export const INCOME_LABELS = {
  personal: { label: 'Net monthly pay', hint: 'What reaches your account each month, after tax and deductions.', short: 'net pay' },
  business: { label: 'Average monthly revenue', hint: 'What the business takes in a month, on average over the last six months.', short: 'monthly revenue' },
}

const amountOf = (value) => {
  const number = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(number) && number >= 0 ? number : null
}

/** The applicant's figures, cleaned; null when the income isn't given yet. */
export const readFigures = (figures) => {
  const income = amountOf(figures?.income)
  if (!income) return null
  return { income, commitments: amountOf(figures?.commitments) || 0 }
}

/** What they can put towards this product's instalment each month. */
export const monthlyBudget = (product, figures) => Math.floor(figures.income * product.eligibility.repaymentShare - figures.commitments)

/** The largest amount whose instalment over `tenure` months fits the budget, rounded down to K100 and capped at the product's largest loan. */
export const largestAffordable = (product, budget, tenure = product.maxTenure) => {
  if (budget <= 0) return 0
  const months = Math.max(1, Number(tenure) || 1)
  const timesInterest = product.interestBasis === 'month' ? months : 1
  const fixedFee = product.facilityFeeType === 'percent' ? 0 : Number(product.facilityFee) || 0
  const feeShare = product.facilityFeeType === 'percent' ? Number(product.facilityFee) || 0 : 0
  const amount = (budget * months - fixedFee) / (1 + product.interestRate * timesInterest + feeShare)
  return Math.max(0, Math.min(product.maxAmount, Math.floor(amount / 100) * 100))
}

/**
 * Whether the applicant qualifies for `product`:
 *   { status: 'unknown' }                                     no figures yet
 *   { status: 'eligible', budget, maxAmount }                 maxAmount: the most they can borrow
 *   { status: 'ineligible', budget, maxAmount, reason }       reason: for the applicant
 */
export const eligibilityFor = (product, rawFigures) => {
  const figures = readFigures(rawFigures)
  if (!figures) return { status: 'unknown' }
  const words = INCOME_LABELS[product.form]
  const { minIncome } = product.eligibility
  const budget = monthlyBudget(product, figures)
  const maxAmount = largestAffordable(product, budget)
  if (minIncome && figures.income < minIncome) {
    return { status: 'ineligible', budget, maxAmount, reason: `Needs ${words.short} of at least ${formatKwacha(minIncome)} a month.` }
  }
  if (budget <= 0) {
    return { status: 'ineligible', budget, maxAmount: 0, reason: `Your existing repayments already use what this loan allows of your ${words.short}.` }
  }
  if (maxAmount < product.minAmount) {
    return {
      status: 'ineligible',
      budget,
      maxAmount,
      reason: `Your budget of ${formatKwacha(budget)} a month covers up to ${formatKwacha(maxAmount)}; the smallest loan is ${formatKwacha(product.minAmount)}.`,
    }
  }
  return { status: 'eligible', budget, maxAmount }
}

/**
 * What is wrong with this amount and tenure for the applicant, or null: they must qualify
 * for the product, and the instalment must fit their budget.
 */
export const affordabilityError = (product, rawFigures, amount, tenure) => {
  const words = INCOME_LABELS[product.form]
  const result = eligibilityFor(product, rawFigures)
  if (result.status === 'unknown') return `Enter your ${words.short} so we can check what you qualify for.`
  if (result.status === 'ineligible') return result.reason
  const { monthly } = priceLoan(amount, tenure, product)
  if (monthly > result.budget) {
    const atTenure = largestAffordable(product, result.budget, tenure)
    return `At ${formatKwacha(amount)} over ${tenure} months the instalment is ${formatKwacha(Math.ceil(monthly))}, more than your budget of ${formatKwacha(result.budget)} a month. ${
      atTenure >= product.minAmount ? `Borrow up to ${formatKwacha(atTenure)}, or choose a longer tenure.` : 'Choose a longer tenure.'
    }`
  }
  return null
}

/** How far a typed income may stray from what the documents show before it is flagged: 5%. */
export const INCOME_TOLERANCE = 0.05

/**
 * The income the applicant typed against the one their documents show (payslip net pay, or a
 * business's average monthly bank credits): null when either is unknown, else
 * { stated, found, differs } — differs when they are more than INCOME_TOLERANCE apart.
 */
export const compareIncome = (stated, found) => {
  const typed = amountOf(stated)
  const read = amountOf(found)
  if (!typed || !read) return null
  return { stated: typed, found: read, differs: Math.abs(typed - read) / read > INCOME_TOLERANCE }
}

/** "Secured", "Short-term", "Fixed rate"…: how a product classifies, worked out from its settings. */
export const productTags = (product) => {
  const requirement = product.collateral?.requirement
  const secured = requirement === 'required' ? 'Secured' : requirement === 'amount' ? `Secured from ${formatKwacha(product.collateral.requiredFrom)}` : 'Unsecured'
  const term = product.maxTenure <= 12 ? 'Short-term' : product.maxTenure <= 60 ? 'Medium-term' : 'Long-term'
  return [secured, term, product.interestType === 'variable' ? 'Variable rate' : 'Fixed rate']
}
