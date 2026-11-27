import { describe, it, expect } from 'vitest'
import { defaultTerms, checkTerms, lusakaDate, monthlyEquivalent, scheduleFor, summarizeTerms } from '../src/config/loanTerms.js'
import { computeFacts } from '../api/_lib/prescreen/facts.js'

const product = { minAmount: 500, maxAmount: 100000, minTenure: 1, maxTenure: 24, interestRate: 0.1, interestBasis: 'loan', facilityFee: 175, facilityFeeType: 'fixed', interestType: 'fixed' }

describe('loan terms engine', () => {
  it('defaults keep today’s price at the requested tenure', () => {
    const terms = defaultTerms(product, { amount: 10000, tenure: 6 }, new Date('2026-11-26T12:00:00'))
    expect(terms).toMatchObject({ amount: 10000, tenure: 6, frequency: 'monthly', annualRate: 20, calculation: 'flat', effectiveDate: '2026-11-26', charges: [{ name: 'Facility fee', type: 'fixed', value: 175 }] })
    expect(summarizeTerms(terms).totalInterest).toBe(1000) // == priceLoan interest today
    expect(defaultTerms({ ...product, interestRate: 0.04, interestBasis: 'month' }, { amount: 10000, tenure: 6 }).annualRate).toBe(48)
  })
  it('default price stays within a few ngwee of today’s at tenures that don’t divide 12', () => {
    const terms = defaultTerms(product, { amount: 10000, tenure: 7 })
    expect(Math.abs(summarizeTerms(terms).totalInterest - 1000)).toBeLessThanOrEqual(0.01)
  })
  it('flat: equal instalments, the last absorbs rounding', () => {
    const terms = { amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'flat', effectiveDate: '2026-01-15', charges: [] }
    const s = summarizeTerms(terms)
    expect(s).toMatchObject({ periods: 12, instalment: 1033.33, totalInterest: 2400, totalRepayable: 12400, firstDue: '2026-02-15', lastDue: '2027-01-15' })
    const rows = scheduleFor(terms)
    expect(rows.at(-1)).toMatchObject({ instalment: 1033.37, balance: 0 })
  })
  it('reducing balance: annuity instalment, interest on the balance', () => {
    const terms = { amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'reducing', effectiveDate: '2026-01-15', charges: [] }
    const rows = scheduleFor(terms)
    expect(rows[0]).toMatchObject({ instalment: 945.6, interest: 200, principal: 745.6 })
    expect(rows.at(-1).balance).toBe(0)
    expect(summarizeTerms(terms).totalInterest).toBeCloseTo(1347.15, 2)
  })
  it('weekly on a short tenure rounds to whole periods and still adds up', () => {
    const terms = { amount: 1000, tenure: 1, frequency: 'weekly', annualRate: 52, calculation: 'flat', effectiveDate: '2026-01-01', charges: [] }
    const rows = scheduleFor(terms)
    expect(rows).toHaveLength(4)
    expect(rows[0].due).toBe('2026-01-08')
    expect(rows.reduce((sum, row) => sum + row.instalment, 0)).toBeCloseTo(summarizeTerms(terms).totalRepayable, 2)
  })
  it('clamps month-end due dates', () => {
    const rows = scheduleFor({ amount: 1000, tenure: 3, frequency: 'monthly', annualRate: 12, calculation: 'flat', effectiveDate: '2026-01-31', charges: [] })
    expect(rows.map((row) => row.due)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('charges come off the payout', () => {
    const s = summarizeTerms({ amount: 350000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'flat', effectiveDate: '2026-01-15', charges: [{ name: 'Processing fee', type: 'percent', value: 2 }] })
    expect(s).toMatchObject({ totalCharges: 7000, netDisbursed: 343000 })
  })
  it('refuses terms out of range, charges that eat the loan, and a missing date', () => {
    const base = defaultTerms(product, { amount: 10000, tenure: 6 })
    expect(checkTerms({ ...base, annualRate: 0 }, product).errors.annualRate).toMatch(/0\.1% and 300%/)
    expect(checkTerms({ ...base, annualRate: 301 }, product).errors.annualRate).toBeTruthy()
    expect(checkTerms({ ...base, amount: 200 }, product).errors.amount).toMatch(/K500 and K100,000/)
    expect(checkTerms({ ...base, tenure: 30 }, product).errors.tenure).toMatch(/1 and 24 months/)
    expect(checkTerms({ ...base, charges: [{ name: 'Insurance', type: 'percent', value: 100 }] }, product).errors.charges).toMatch(/can’t be the whole loan/)
    expect(checkTerms({ ...base, effectiveDate: '' }, product).errors.effectiveDate).toBeTruthy()
    expect(checkTerms({ ...base, frequency: 'daily' }, product).errors.frequency).toBeTruthy()
    expect(checkTerms(base, product).errors).toEqual({})
  })
  it('coerces numbers and drops charges with blank names', () => {
    const base = defaultTerms(product, { amount: 10000, tenure: 6 })
    const { terms, errors } = checkTerms({ ...base, amount: '10000', tenure: '6', charges: [...base.charges, { name: '  ', type: 'fixed', value: 5 }] }, product)
    expect(errors).toEqual({})
    expect(terms.amount).toBe(10000)
    expect(terms.charges).toHaveLength(1)
  })
  it('keeps only the fields an appraiser sets', () => {
    const base = defaultTerms(product, { amount: 10000, tenure: 6 })
    const { terms, errors } = checkTerms({ ...base, paidOutOn: '2020-01-01', summary: { instalment: 1 }, savedBy: 'someone', extra: 'x' }, product)
    expect(errors).toEqual({})
    expect(Object.keys(terms).sort()).toEqual(['amount', 'annualRate', 'calculation', 'charges', 'effectiveDate', 'frequency', 'interestType', 'tenure'])
  })
  it('caps charges at ten, keeps names to one short line, and rounds the amount to the ngwee', () => {
    const base = defaultTerms(product, { amount: 10000, tenure: 6 })
    const many = Array.from({ length: 11 }, (_, index) => ({ name: `Fee ${index}`, type: 'fixed', value: 1 }))
    expect(checkTerms({ ...base, charges: many }, product).errors.charges).toBe('Up to 10 charges.')
    expect(checkTerms({ ...base, charges: many.slice(0, 10) }, product).errors.charges).toBeUndefined()
    const { terms } = checkTerms({ ...base, amount: 10000.456, charges: [{ name: `Legal\nfee\u0007 ${'x'.repeat(80)}`, type: 'fixed', value: 10 }] }, product)
    expect(terms.amount).toBe(10000.46)
    expect(terms.charges[0].name).toMatch(/^Legal fee x+$/)
    expect(terms.charges[0].name.length).toBeLessThanOrEqual(60)
  })
  it('needs whole quarters for quarterly repayments', () => {
    const base = defaultTerms(product, { amount: 10000, tenure: 6 })
    expect(checkTerms({ ...base, frequency: 'quarterly', tenure: 7 }, product).errors.frequency).toBe('Quarterly repayments need a tenure in whole quarters (3, 6, 9… months).')
    expect(checkTerms({ ...base, frequency: 'quarterly', tenure: 9 }, product).errors).toEqual({})
  })
  it('dates the default effective date by the Lusaka calendar', () => {
    // 23:30 UTC is already the next day in Lusaka (UTC+2).
    expect(lusakaDate(new Date('2026-11-26T23:30:00Z'))).toBe('2026-11-27')
    expect(defaultTerms(product, { amount: 10000, tenure: 6 }, new Date('2026-11-26T23:30:00Z')).effectiveDate).toBe('2026-11-27')
  })
  it('gives the credit rules a monthly instalment for weekly terms', () => {
    const terms = { amount: 10000, tenure: 6, frequency: 'weekly', annualRate: 24, interestType: 'fixed', calculation: 'flat', effectiveDate: '2026-01-01', charges: [] }
    const weekly = summarizeTerms(terms).instalment
    expect(monthlyEquivalent(terms)).toBeCloseTo((weekly * 52) / 12, 2)
    const application = { loanType: 'personal', amount: 10000, tenure: 6, monthlyInstalment: 1900, terms, data: { personalInfo: {} }, checks: { figures: { netPay: { value: 10000 } } } }
    const facts = computeFacts(application, [])
    expect(facts.monthly_instalment).toBeCloseTo((weekly * 52) / 12, 2)
    expect(facts.debt_to_income).toBeCloseTo(((weekly * 52) / 12) / 10000, 3)
    expect(computeFacts({ ...application, terms: null }, []).monthly_instalment).toBe(1900)
  })
})
