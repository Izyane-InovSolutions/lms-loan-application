/**
 * Loan terms: what an appraiser structures for an application (amount, tenure, repayment
 * frequency, rate, calculation method, charges) and the schedule those terms produce.
 * Pure functions, shared by the browser and the server.
 */

import { INTEREST_TYPES } from './loanProducts.js'

export { INTEREST_TYPES }

export const FREQUENCIES = {
  monthly: { label: 'Monthly', perYear: 12, per: 'a month' },
  fortnightly: { label: 'Fortnightly', perYear: 26, per: 'a fortnight' },
  weekly: { label: 'Weekly', perYear: 52, per: 'a week' },
  quarterly: { label: 'Quarterly', perYear: 4, per: 'a quarter' },
}

/** "a week", "a month"…: how often an instalment is paid (a month for a case without terms). */
export const perPeriod = (frequency) => FREQUENCIES[frequency]?.per || 'a month'

export const CALCULATIONS = { flat: 'Flat', reducing: 'Reducing balance' }

export const CHARGE_NAMES = ['Processing fee', 'VAT', 'Insurance', 'Legal fee', 'Valuation fee']

const MIN_RATE = 0.1
const MAX_RATE = 300

const round2 = (value) => Math.round(value * 100) / 100

const pad = (value) => String(value).padStart(2, '0')
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' as a UTC Date, or null when it isn't a real date. */
const parseDate = (value) => {
  const match = DATE_PATTERN.exec(String(value || ''))
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value ? date : null
}

const formatDate = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

const addDays = (date, days) => new Date(date.getTime() + days * 86400000)

// Month addition clamps to the month's last day (31 Jan + 1 month = 28 Feb).
const addMonths = (date, months) => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target
}

const dueDate = (start, frequency, number) => {
  if (frequency === 'monthly') return addMonths(start, number)
  if (frequency === 'quarterly') return addMonths(start, number * 3)
  return addDays(start, number * (frequency === 'fortnightly' ? 14 : 7))
}

const LUSAKA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The calendar day in Lusaka of a moment, as 'YYYY-MM-DD' (dates on the loan are Lusaka days). */
export const lusakaDate = (date = new Date()) => LUSAKA_DAY.format(date)

/** Number of repayments over a tenure (months) at a frequency: at least one. */
export const periodsFor = (tenure, frequency) =>
  Math.max(1, Math.round((Number(tenure) * (FREQUENCIES[frequency]?.perYear || 12)) / 12))

/** A charge in kwacha on a loan amount. */
export const chargeAmount = (charge, amount) =>
  round2(charge.type === 'percent' ? (Number(amount) * Number(charge.value)) / 100 : Number(charge.value))

/**
 * The terms a product starts from: the applicant's amount and tenure, today's flat pricing
 * expressed as an annual rate, and the product's facility fee as the first charge.
 */
export const defaultTerms = (product, application, today = new Date()) => {
  const tenure = Number(application?.tenure) || product.defaultTenure || product.minTenure || 1
  const percentFee = product.facilityFeeType === 'percent'
  return {
    amount: Number(application?.amount) || 0,
    tenure,
    frequency: 'monthly',
    annualRate: Math.round(1e4 * product.interestRate * 100 * (product.interestBasis === 'month' ? 12 : 12 / tenure)) / 1e4,
    interestType: product.interestType || 'fixed',
    calculation: 'flat',
    effectiveDate: lusakaDate(today),
    charges: [{ name: 'Facility fee', type: percentFee ? 'percent' : 'fixed', value: percentFee ? round2(product.facilityFee * 100) : product.facilityFee }],
  }
}

const MAX_CHARGES = 10
const MAX_CHARGE_NAME = 60

/**
 * Coerce and validate terms against a product's limits: { terms, errors: { field: message } }.
 * Only the fields an appraiser sets are kept: anything else in the input (paidOutOn, a
 * summary…) never comes from the client.
 */
export const checkTerms = (input, product) => {
  const source = input || {}
  const rawCharges = Array.isArray(source.charges) ? source.charges : []
  const charges = rawCharges
    .map((charge) => ({
      // One line, no control characters: the name is printed in the letters, one charge a line.
      name: String(charge?.name || '')
        .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CHARGE_NAME)
        .trim(),
      type: charge?.type,
      value: Number(charge?.value),
    }))
    .filter((charge) => charge.name)
  const amount = Number(source.amount)
  const terms = {
    amount: Number.isFinite(amount) ? round2(amount) : amount,
    tenure: Number(source.tenure),
    frequency: source.frequency,
    annualRate: Number(source.annualRate),
    interestType: source.interestType,
    calculation: source.calculation,
    effectiveDate: source.effectiveDate,
    charges,
  }
  const errors = {}
  if (!(terms.amount >= product.minAmount && terms.amount <= product.maxAmount))
    errors.amount = `Choose an amount between K${product.minAmount.toLocaleString('en-US')} and K${product.maxAmount.toLocaleString('en-US')}.`
  if (!(Number.isInteger(terms.tenure) && terms.tenure >= product.minTenure && terms.tenure <= product.maxTenure))
    errors.tenure = `Choose a whole number of months between ${product.minTenure} and ${product.maxTenure} months.`
  if (!(terms.annualRate >= MIN_RATE && terms.annualRate <= MAX_RATE)) errors.annualRate = `Enter a rate between ${MIN_RATE}% and ${MAX_RATE}%.`
  if (!FREQUENCIES[terms.frequency]) errors.frequency = 'Choose how often the loan is repaid.'
  else if (terms.frequency === 'quarterly' && !errors.tenure && terms.tenure % 3 !== 0)
    errors.frequency = 'Quarterly repayments need a tenure in whole quarters (3, 6, 9… months).'
  if (!CALCULATIONS[terms.calculation]) errors.calculation = 'Choose how interest is calculated.'
  if (!INTEREST_TYPES[terms.interestType]) errors.interestType = 'Choose an interest type.'
  if (!parseDate(terms.effectiveDate)) errors.effectiveDate = 'Enter the date the loan takes effect.'
  if (charges.length > MAX_CHARGES) errors.charges = `Up to ${MAX_CHARGES} charges.`
  else if (charges.some((charge) => !['fixed', 'percent'].includes(charge.type) || !(charge.value >= 0))) errors.charges = 'Each charge needs a type and an amount of zero or more.'
  else if (!errors.amount && charges.reduce((sum, charge) => sum + chargeAmount(charge, terms.amount), 0) >= terms.amount)
    errors.charges = 'Charges can’t be the whole loan or more.'
  return { terms, errors }
}

const flatInterest = (terms) => round2((terms.amount * terms.annualRate * terms.tenure) / 1200)

/** The repayment schedule: [{ number, due, instalment, principal, interest, balance }]. */
export const scheduleFor = (terms, start = terms.effectiveDate) => {
  const periods = periodsFor(terms.tenure, terms.frequency)
  const startDate = parseDate(start)
  const rate = terms.annualRate / 100 / FREQUENCIES[terms.frequency].perYear
  const flat = terms.calculation !== 'reducing'
  const totalInterest = flatInterest(terms)
  const level = flat
    ? round2((terms.amount + totalInterest) / periods)
    : round2(rate === 0 ? terms.amount / periods : (terms.amount * rate) / (1 - (1 + rate) ** -periods))
  let balance = terms.amount
  let interestLeft = totalInterest
  return Array.from({ length: periods }, (_, index) => {
    const last = index === periods - 1
    let interest
    let principal
    if (flat) {
      interest = last ? interestLeft : round2(totalInterest / periods)
      principal = last ? balance : round2(level - interest)
    } else {
      interest = round2(balance * rate)
      principal = last ? balance : round2(level - interest)
    }
    interestLeft = round2(interestLeft - interest)
    balance = round2(balance - principal)
    return {
      number: index + 1,
      due: formatDate(dueDate(startDate, terms.frequency, index + 1)),
      instalment: round2(principal + interest),
      principal,
      interest,
      balance: Math.max(0, balance),
    }
  })
}

/** Totals for a set of terms. totalRepayable is the amount plus interest; charges are taken off the payout. */
export const summarizeTerms = (terms) => {
  const rows = scheduleFor(terms)
  const totalInterest = round2(rows.reduce((sum, row) => sum + row.interest, 0))
  const totalCharges = round2((terms.charges || []).reduce((sum, charge) => sum + chargeAmount(charge, terms.amount), 0))
  return {
    periods: rows.length,
    instalment: rows[0].instalment,
    totalInterest,
    totalCharges,
    totalRepayable: round2(terms.amount + totalInterest),
    netDisbursed: round2(terms.amount - totalCharges),
    firstDue: rows[0].due,
    lastDue: rows.at(-1).due,
  }
}

/** What holds a move out of the terms stage: null once valid terms are saved for the product. */
export const termsHold = (application, product) => {
  const saved = application?.terms
  return saved && !Object.keys(checkTerms(saved, product).errors).length ? null : 'the loan terms'
}

/** The instalment as a monthly figure (instalment × instalments a year ÷ 12), for affordability. */
export const monthlyEquivalent = (terms) => round2((summarizeTerms(terms).instalment * (FREQUENCIES[terms.frequency]?.perYear || 12)) / 12)
