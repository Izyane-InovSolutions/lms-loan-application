/**
 * Product eligibility rules (Policy rules → Product eligibility): what an applicant must
 * meet, from their documents and answers, to qualify for a loan product. Shared by the
 * server, which matches a draft to products and checks again on submission, and the rules
 * editor.
 *
 * Unlike a credit rule (a concern that fires), an eligibility rule is a requirement:
 * "Net monthly pay (from payslip) is at least K5,000". Not meeting it rules the product out,
 * with the rule's message for the applicant. A rule over a figure that isn't known yet (a
 * payslip the AI couldn't read) is skipped and reported as unchecked, never failed.
 *
 *   { id, fact, operator, value, message, products: [productId], loanTypes: [loanTypeKey], enabled }
 *
 * `products` and `loanTypes` scope it: empty both, every product; else the products named
 * and every product of the loan types named. A rule only ever applies to products whose
 * form has the fact (FACTS loanTypes, by form).
 *
 * Matching runs before the applicant has chosen an amount, so only facts known by then
 * can be used (ELIGIBILITY_FACTS): what the documents show and what the form says. Possible
 * tampering isn't one: a rule's message reaches the applicant, so it stays with the credit rules.
 */

import { FACTS, OPERATORS, flattenPolicies, formatFact, isEligibilityRule } from './creditRules.js'
import { INCOME_LABELS, eligibilityFor } from './eligibility.js'

export const ELIGIBILITY_FACT_KEYS = [
  'net_monthly_pay',
  'average_monthly_credits',
  'annual_turnover',
  'applicant_age',
  'business_age_months',
  'directors_count',
  'identity_mismatches',
  'documents_wrong_type',
  'documents_outdated',
  'documents_illegible',
]

/**
 * Rules over what is wrong with an uploaded document, not with the applicant: someone else's
 * name on it, the wrong document, outdated, unreadable. A matched applicant who fails only
 * these may continue anyway (their choice is filed for the officer); any other rule, and
 * affordability, still rules the product out.
 */
export const DOCUMENT_RULE_FACTS = ['identity_mismatches', 'documents_wrong_type', 'documents_outdated', 'documents_illegible']

export const ELIGIBILITY_FACTS = Object.fromEntries(ELIGIBILITY_FACT_KEYS.map((key) => [key, FACTS[key]]))

export const ELIGIBILITY_OPERATORS = Object.fromEntries(['gte', 'gt', 'lte', 'lt', 'eq', 'neq'].map((key) => [key, OPERATORS[key]]))

/**
 * Where every workspace starts: the basics no lender would skip. Edited and published like
 * any rule. Signs of tampering are left to the credit rules, which refer the case to an
 * officer: an eligibility rule's message is shown to the applicant, and that would tell them.
 */
export const DEFAULT_ELIGIBILITY_RULES = [
  { id: 'e1', fact: 'applicant_age', operator: 'gte', value: 18, message: 'You must be 18 or older.', products: [], loanTypes: [], enabled: true },
  { id: 'e2', fact: 'identity_mismatches', operator: 'eq', value: 0, message: 'The name or NRC on your documents must match what you entered.', products: [], loanTypes: [], enabled: true },
  { id: 'e4', fact: 'business_age_months', operator: 'gte', value: 12, message: 'The business must have traded for at least a year.', products: ['business-term-loan', 'commercial-property-loan', 'asset-finance-loan'], loanTypes: [], enabled: true },
]

/** A ruleset's eligibility rules (rulesets.rules.eligibility); the defaults until any are saved. */
export const rulesetEligibility = (stored) => (stored && !Array.isArray(stored) && Array.isArray(stored.eligibility) ? stored.eligibility : DEFAULT_ELIGIBILITY_RULES)

const meets = (operator, actual, expected) => {
  switch (operator) {
    case 'gt':
      return actual > expected
    case 'gte':
      return actual >= expected
    case 'lt':
      return actual < expected
    case 'lte':
      return actual <= expected
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    default:
      return false
  }
}

/** The rules that apply to a product: on, in scope, and over a fact its form has. */
export const rulesForProduct = (product, rules) =>
  (rules || []).filter(
    (rule) =>
      rule.enabled !== false &&
      FACTS[rule.fact]?.loanTypes.includes(product.form) &&
      ((!rule.products?.length && !rule.loanTypes?.length) || rule.products?.includes(product.id) || rule.loanTypes?.includes(product.loanType))
  )

/** "Net monthly pay (from payslip) is at least K5,000" */
export const describeEligibilityRule = (rule) => `${FACTS[rule.fact]?.label || rule.fact} ${OPERATORS[rule.operator]?.label || ''} ${formatFact(rule.fact, rule.value)}`.trim()

/** { failed: [{ id, message, requirement, actual }], unchecked: [{ id, requirement }] } for a product, from `facts`. */
export const checkRules = (product, rules, facts) => {
  const failed = []
  const unchecked = []
  for (const rule of rulesForProduct(product, rules)) {
    const actual = facts?.[rule.fact]
    if (actual === null || actual === undefined || Number.isNaN(actual)) {
      unchecked.push({ id: rule.id, requirement: describeEligibilityRule(rule) })
    } else if (!meets(rule.operator, actual, rule.value)) {
      failed.push({ id: rule.id, message: rule.message, requirement: describeEligibilityRule(rule), actual: formatFact(rule.fact, actual), document: DOCUMENT_RULE_FACTS.includes(rule.fact) })
    }
  }
  return { failed, unchecked }
}

/** Whether every rule not met is about a document, so the applicant may continue anyway. */
export const onlyDocumentIssues = (failed) => failed.length > 0 && failed.every((entry) => entry.document)

// A "not eligible" rule fires when its condition holds; as a requirement it is the opposite.
const OPPOSITE = { gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt', eq: 'neq', neq: 'eq' }

/**
 * The policies' "Not eligible for…" rules (Policy rules, e.g. the Personal Policy's net pay
 * bands, creditRules.js) as requirements the matching applies to the products they name.
 */
export const policyEligibilityRules = (policies) =>
  flattenPolicies(policies)
    .filter((entry) => isEligibilityRule(entry) && entry.enabled && OPPOSITE[entry.operator])
    .map((entry) => ({ id: `policy:${entry.id}`, fact: entry.fact, operator: OPPOSITE[entry.operator], value: entry.value, message: entry.message, products: entry.products || [], loanTypes: [], enabled: true }))

/** The figures income-based rules test: net pay for a person, monthly bank credits for a business. */
export const INCOME_FACTS = { personal: 'net_monthly_pay', business: 'average_monthly_credits' }

/**
 * `facts` with the income the applicant qualifies on in place of the income figure (the
 * documents' when read, else what they stated), so a net pay band decides on it.
 */
export const withIncome = (form, facts, income) => (income ? { ...facts, [INCOME_FACTS[form]]: income } : facts)

/** The income matching goes on: what the documents show, else what the applicant stated (unverified). */
export const incomeFor = (form, facts, stated) => {
  const fromDocuments = form === 'personal' ? facts?.net_monthly_pay : facts?.average_monthly_credits
  if (fromDocuments) return { income: fromDocuments, source: 'documents' }
  const typed = Number(String(stated ?? '').replace(/[^0-9.]/g, ''))
  return typed > 0 ? { income: typed, source: 'stated' } : { income: null, source: null }
}

/**
 * Every product of a loan type matched against the applicant: the eligibility rules, then
 * the affordability of its smallest loan (eligibility.js) on the income from incomeFor.
 * Returns { income, products: [{ id, status, maxAmount, budget, reasons, unchecked }] },
 * products they qualify for first, largest amounts first.
 */
export const matchProducts = (products, rules, facts, { form, statedIncome, commitments }) => {
  const income = incomeFor(form, facts, statedIncome)
  const qualifying = withIncome(form, facts, income.income)
  const results = products.map((product) => {
    const { failed, unchecked } = checkRules(product, rules, qualifying)
    const afford = income.income ? eligibilityFor(product, { income: income.income, commitments }) : { status: 'unknown' }
    const reasons = [...failed.map((entry) => entry.message), ...(afford.status === 'ineligible' ? [afford.reason] : [])]
    const status = reasons.length ? 'ineligible' : afford.status === 'eligible' ? 'eligible' : 'unknown'
    // Held back only by a document issue, and affordable: they may choose it anyway.
    const canContinue = status === 'ineligible' && afford.status === 'eligible' && onlyDocumentIssues(failed)
    return { id: product.id, status, canContinue, maxAmount: afford.maxAmount ?? null, budget: afford.budget ?? null, reasons, unchecked: unchecked.map((entry) => entry.requirement) }
  })
  results.sort((a, b) => (b.status === 'eligible') - (a.status === 'eligible') || (b.maxAmount || 0) - (a.maxAmount || 0))
  return { income: { ...income, label: INCOME_LABELS[form].label }, products: results }
}

/** Throws a readable message for the first problem; returns the cleaned rules. `productIds` and `loanTypeKeys` are those that exist. */
export const validateEligibilityRules = (rules, { productIds = null, loanTypeKeys = null } = {}) => {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('Eligibility rules must be a list of at most 100.')
  const ids = new Set()
  return rules.map((entry, index) => {
    const where = `Eligibility rule ${index + 1}`
    const fact = ELIGIBILITY_FACTS[entry?.fact]
    if (!fact) throw new Error(`${where}: choose what it checks.`)
    if (!ELIGIBILITY_OPERATORS[entry.operator]) throw new Error(`${where}: choose a comparison.`)
    const value = Number(entry.value)
    if (!Number.isFinite(value) || entry.value === '' || entry.value === null) throw new Error(`${where}: enter a number to compare with.`)
    const message = String(entry.message || '').trim().slice(0, 300)
    if (!message) throw new Error(`${where}: say what the applicant needs, for when they don’t meet it.`)
    const products = [...new Set(Array.isArray(entry.products) ? entry.products.map(String) : [])].filter((id) => !productIds || productIds.includes(id))
    const loanTypes = [...new Set(Array.isArray(entry.loanTypes) ? entry.loanTypes.map(String) : [])].filter((key) => !loanTypeKeys || loanTypeKeys.includes(key))
    let id = String(entry.id || '').slice(0, 40) || `e${index + 1}`
    while (ids.has(id)) id = `${id}x`
    ids.add(id)
    return { id, fact: entry.fact, operator: entry.operator, value, message, products, loanTypes, enabled: entry.enabled !== false }
  })
}
