/**
 * Credit rules: the facts they can test, the operators, the default policy, and the
 * evaluator. Pure and shared — the server evaluates for real; the admin UI uses the same
 * code to describe rules and preview them.
 *
 * A rule describes a *concern*: it fires when its condition is true. For example
 * "debt-to-income is greater than 0.4 → refer". Firing rules decide the outcome:
 *   any decline → decline,  else any refer → refer,  else pass (warnings are listed).
 * Rules recommend; unless an administrator turns on automatic decline, a person decides.
 */

/** Everything a rule can test. `unit` drives formatting; `loanTypes` limits where it applies. */
export const FACTS = {
  amount: { label: 'Loan amount', unit: 'kwacha', loanTypes: ['personal', 'business'] },
  tenure: { label: 'Tenure', unit: 'months', loanTypes: ['personal', 'business'] },
  monthly_instalment: { label: 'Monthly instalment', unit: 'kwacha', loanTypes: ['personal', 'business'] },
  applicant_age: { label: 'Applicant age', unit: 'years', loanTypes: ['personal', 'business'] },
  age_at_maturity: { label: 'Age when the loan ends', unit: 'years', loanTypes: ['personal'] },
  net_monthly_pay: { label: 'Net monthly pay (from payslip)', unit: 'kwacha', loanTypes: ['personal'] },
  debt_to_income: { label: 'Instalment ÷ net pay', unit: 'ratio', loanTypes: ['personal'] },
  average_monthly_credits: { label: 'Average monthly bank credits', unit: 'kwacha', loanTypes: ['personal', 'business'] },
  instalment_to_credits: { label: 'Instalment ÷ monthly bank credits', unit: 'ratio', loanTypes: ['personal', 'business'] },
  business_age_months: { label: 'Business age', unit: 'months', loanTypes: ['business'] },
  annual_turnover: { label: 'Declared turnover (tax return)', unit: 'kwacha', loanTypes: ['business'] },
  loan_to_turnover: { label: 'Loan ÷ turnover', unit: 'ratio', loanTypes: ['business'] },
  order_value: { label: 'Order / invoice value', unit: 'kwacha', loanTypes: ['business'] },
  loan_to_order: { label: 'Loan ÷ order value', unit: 'ratio', loanTypes: ['business'] },
  directors_count: { label: 'Number of directors', unit: 'count', loanTypes: ['business'] },
  documents_wrong_type: { label: 'Documents that are not what was asked for', unit: 'count', loanTypes: ['personal', 'business'] },
  documents_illegible: { label: 'Documents that are hard to read', unit: 'count', loanTypes: ['personal', 'business'] },
  documents_outdated: { label: 'Documents that are outdated or expired', unit: 'count', loanTypes: ['personal', 'business'] },
  documents_unchecked: { label: 'Documents the AI could not check', unit: 'count', loanTypes: ['personal', 'business'] },
  identity_mismatches: { label: 'Name or NRC mismatches with documents', unit: 'count', loanTypes: ['personal', 'business'] },
  authenticity_concerns: { label: 'Possible tampering flagged', unit: 'count', loanTypes: ['personal', 'business'] },
  location_provided: { label: 'Location shared at submission', unit: 'boolean', loanTypes: ['personal', 'business'] },
  location_distance_km: { label: 'Distance from stated address', unit: 'km', loanTypes: ['personal', 'business'] },
  address_found: { label: 'Home address found on the map', unit: 'boolean', loanTypes: ['personal', 'business'] },
  crb_score: { label: 'Credit bureau score', unit: 'score', loanTypes: ['personal', 'business'] },
}

export const OPERATORS = {
  gt: { label: 'is greater than', symbol: '>' },
  gte: { label: 'is at least', symbol: '≥' },
  lt: { label: 'is less than', symbol: '<' },
  lte: { label: 'is at most', symbol: '≤' },
  eq: { label: 'is', symbol: '=' },
  neq: { label: 'is not', symbol: '≠' },
  missing: { label: 'is unknown', symbol: '?', noValue: true },
}

export const OUTCOMES = {
  decline: { label: 'Decline', rank: 3 },
  refer: { label: 'Refer to officer', rank: 2 },
  warn: { label: 'Warn', rank: 1 },
}

let seed = 0
const rule = (fact, operator, value, outcome, message, extra = {}) => ({
  id: `r${(seed += 1)}`,
  fact,
  operator,
  value,
  outcome,
  message,
  loanTypes: FACTS[fact].loanTypes,
  enabled: true,
  ...extra,
})

/**
 * The starting policy. The thresholds are placeholders to be replaced with the lender's
 * own figures in Rules — they are deliberately conservative (refer rather than decline).
 */
export const DEFAULT_RULES = [
  rule('debt_to_income', 'gt', 0.4, 'refer', 'The instalment is more than 40% of net pay.'),
  rule('net_monthly_pay', 'missing', null, 'refer', 'Net pay could not be read from the payslips, so affordability is unverified.'),
  rule('instalment_to_credits', 'gt', 0.5, 'warn', 'The instalment is more than half of average monthly bank credits.'),
  rule('applicant_age', 'lt', 18, 'decline', 'The applicant is under 18.'),
  rule('age_at_maturity', 'gt', 65, 'refer', 'The loan runs past the usual retirement age.'),
  rule('business_age_months', 'lt', 12, 'refer', 'The business has traded for less than a year.'),
  rule('loan_to_order', 'gt', 1, 'refer', 'The loan is larger than the order or invoice it finances.'),
  rule('loan_to_turnover', 'gt', 0.5, 'refer', 'The loan is more than half of declared annual turnover.'),
  rule('documents_wrong_type', 'gt', 0, 'refer', 'At least one upload is not the document that was asked for.'),
  rule('documents_outdated', 'gt', 0, 'refer', 'At least one document is outdated or expired.'),
  rule('documents_illegible', 'gt', 0, 'warn', 'At least one document is hard to read.'),
  rule('identity_mismatches', 'gt', 0, 'refer', 'A name or NRC on a document does not match the form.'),
  rule('authenticity_concerns', 'gt', 0, 'refer', 'A document may have been edited. Check the original.'),
  rule('location_provided', 'eq', false, 'warn', 'The applicant did not share their location.'),
  rule('location_distance_km', 'gt', 50, 'warn', 'The applicant was more than 50 km from their stated address.'),
  rule('address_found', 'eq', false, 'refer', 'The home address the applicant typed couldn’t be found on the map. Check it with them.'),
  rule('crb_score', 'lt', 500, 'refer', 'The credit bureau score is below 500.', { enabled: false }),
]

const compare = (operator, actual, expected) => {
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

/**
 * Applies `rules` to `facts` for a loan type. Each result is one of:
 *   fired         the concern applies
 *   passed        it does not
 *   not_evaluated the fact is unknown (a "missing" rule exists to catch that when it matters)
 */
export const evaluateRules = (rules, facts, loanType) => {
  const results = (rules || [])
    .filter((entry) => entry.enabled && (!entry.loanTypes?.length || entry.loanTypes.includes(loanType)))
    .map((entry) => {
      const actual = facts[entry.fact]
      const unknown = actual === null || actual === undefined || Number.isNaN(actual)
      let state
      if (entry.operator === 'missing') state = unknown ? 'fired' : 'passed'
      else if (unknown) state = 'not_evaluated'
      else state = compare(entry.operator, actual, entry.value) ? 'fired' : 'passed'
      return { id: entry.id, fact: entry.fact, operator: entry.operator, value: entry.value, outcome: entry.outcome, message: entry.message, actual: unknown ? null : actual, state }
    })

  const fired = results.filter((result) => result.state === 'fired')
  const outcome = fired.some((result) => result.outcome === 'decline')
    ? 'decline'
    : fired.some((result) => result.outcome === 'refer')
      ? 'refer'
      : 'pass'
  return { outcome, results }
}

/** Throws a readable message for the first problem in a rule list; returns the cleaned list. */
export const validateRules = (rules) => {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('Rules must be a list of at most 100.')
  const ids = new Set()
  return rules.map((entry, index) => {
    const where = `Rule ${index + 1}`
    const fact = FACTS[entry?.fact]
    if (!fact) throw new Error(`${where}: choose what it checks.`)
    if (!OPERATORS[entry.operator]) throw new Error(`${where}: choose a comparison.`)
    if (!OUTCOMES[entry.outcome]) throw new Error(`${where}: choose what happens when it applies.`)
    let value = null
    if (!OPERATORS[entry.operator].noValue) {
      if (fact.unit === 'boolean') {
        if (typeof entry.value !== 'boolean') throw new Error(`${where}: choose yes or no.`)
        value = entry.value
      } else {
        value = Number(entry.value)
        if (!Number.isFinite(value)) throw new Error(`${where}: enter a number to compare with.`)
      }
    }
    const message = String(entry.message || '').trim().slice(0, 300)
    if (!message) throw new Error(`${where}: say what the concern is, for the officer.`)
    const loanTypes = (Array.isArray(entry.loanTypes) ? entry.loanTypes : fact.loanTypes).filter((type) => fact.loanTypes.includes(type))
    if (!loanTypes.length) throw new Error(`${where}: "${fact.label}" does not apply to the chosen products.`)
    let id = String(entry.id || '').slice(0, 40) || `r${index + 1}`
    while (ids.has(id)) id = `${id}x`
    ids.add(id)
    return { id, fact: entry.fact, operator: entry.operator, value, outcome: entry.outcome, message, loanTypes, enabled: entry.enabled !== false }
  })
}

const formatNumber = (value, unit) => {
  if (value === null || value === undefined) return 'unknown'
  if (unit === 'boolean') return value ? 'yes' : 'no'
  if (unit === 'kwacha') return `K${Number(value).toLocaleString('en-ZM', { maximumFractionDigits: 0 })}`
  if (unit === 'ratio') return Number(value).toFixed(2)
  if (unit === 'months') return `${value} months`
  if (unit === 'years') return `${value} years`
  if (unit === 'km') return `${Number(value).toFixed(0)} km`
  return String(value)
}

export const formatFact = (fact, value) => formatNumber(value, FACTS[fact]?.unit)

/** "Instalment ÷ net pay is greater than 0.40" */
export const describeCondition = (entry) => {
  const fact = FACTS[entry.fact]
  const operator = OPERATORS[entry.operator]
  if (!fact || !operator) return 'Incomplete rule'
  if (operator.noValue) return `${fact.label} ${operator.label}`
  return `${fact.label} ${operator.label} ${formatNumber(entry.value, fact.unit)}`
}

// ---------------------------------------------------------------------------
// Policies: named groups of rules, each tied to a product. A rule belongs to one
// policy and inherits that policy's product, so the per-rule product no longer needs
// to be set by hand. The engine still works on a flat rule list — policies are flattened
// into one (each rule carrying its policy's loanTypes) before evaluation, so evaluateRules
// and the prescreen are unchanged.
// ---------------------------------------------------------------------------

export const PRODUCTS = { personal: 'Personal', business: 'Business', both: 'Both' }
export const PRODUCT_KEYS = ['personal', 'business', 'both']

export const productToLoanTypes = (product) => (product === 'both' ? ['personal', 'business'] : [product])

/** The facts a policy for this product may use (a 'both' policy needs facts that apply to both). */
export const factsForProduct = (product) => {
  const needed = productToLoanTypes(product)
  return Object.fromEntries(Object.entries(FACTS).filter(([, fact]) => needed.every((type) => fact.loanTypes.includes(type))))
}

const productForLoanTypes = (loanTypes = []) => {
  const personal = loanTypes.includes('personal')
  const business = loanTypes.includes('business')
  if (personal && business) return 'both'
  return business ? 'business' : 'personal'
}

// A rule as stored inside a policy: the flat rule without its own loanTypes (the policy carries the product).
const toPolicyRule = (rule) => {
  const copy = { ...rule }
  delete copy.loanTypes
  return copy
}

const POLICY_META = {
  personal: { id: 'personal', name: 'Personal Policy' },
  business: { id: 'business', name: 'Business Policy' },
  both: { id: 'general', name: 'General Policy' },
}

const groupRulesIntoPolicies = (rules) => {
  const groups = { personal: [], business: [], both: [] }
  for (const rule of rules) groups[productForLoanTypes(rule.loanTypes)].push(toPolicyRule(rule))
  return PRODUCT_KEYS.filter((product) => groups[product].length).map((product) => ({
    id: POLICY_META[product].id,
    name: POLICY_META[product].name,
    product,
    enabled: true,
    rules: groups[product],
  }))
}

/** The starting policies, built by grouping the default flat rules by product. */
export const DEFAULT_POLICIES = groupRulesIntoPolicies(DEFAULT_RULES)

/**
 * Reads whatever a ruleset stored — the new { policies } shape, or a legacy flat rule
 * array — as a policies list, so old published rulesets still open in the new editor.
 */
export const rulesToPolicies = (stored) => {
  if (stored && !Array.isArray(stored) && Array.isArray(stored.policies)) return stored.policies
  return groupRulesIntoPolicies(Array.isArray(stored) ? stored : [])
}

/** Policies → a flat rule list for the engine: each rule gets its policy's product and on/off. */
export const flattenPolicies = (policies) =>
  (policies || []).flatMap((policy) => {
    const loanTypes = productToLoanTypes(policy.product)
    const policyOn = policy.enabled !== false
    return (policy.rules || []).map((rule) => ({ ...rule, loanTypes, enabled: policyOn && rule.enabled !== false }))
  })

/** Total number of rules across all policies. */
export const countPolicyRules = (policies) => (policies || []).reduce((total, policy) => total + (policy.rules?.length || 0), 0)

let policySeed = 0

/** Throws a readable message for the first problem in a policies list; returns the cleaned list. */
export const validatePolicies = (policies) => {
  if (!Array.isArray(policies) || policies.length > 50) throw new Error('Policies must be a list of at most 50.')
  const policyIds = new Set()
  const names = new Set()
  return policies.map((policy, index) => {
    const where = `Policy ${index + 1}`
    const name = String(policy?.name || '').trim().slice(0, 100)
    if (!name) throw new Error(`${where}: give the policy a name.`)
    if (names.has(name.toLowerCase())) throw new Error(`Two policies are named “${name}”. Give each a different name.`)
    names.add(name.toLowerCase())
    const product = PRODUCT_KEYS.includes(policy?.product) ? policy.product : 'personal'
    let id = String(policy?.id || '').slice(0, 40) || `p${(policySeed += 1)}`
    while (policyIds.has(id)) id = `${id}x`
    policyIds.add(id)

    const allowed = factsForProduct(product)
    const ruleIds = new Set()
    const rules = (Array.isArray(policy?.rules) ? policy.rules : []).map((entry, ruleIndex) => {
      const ruleWhere = `${where}, rule ${ruleIndex + 1}`
      const fact = allowed[entry?.fact]
      if (!fact) throw new Error(`${ruleWhere}: choose what it checks (it must apply to ${PRODUCTS[product]}).`)
      if (!OPERATORS[entry.operator]) throw new Error(`${ruleWhere}: choose a comparison.`)
      if (!OUTCOMES[entry.outcome]) throw new Error(`${ruleWhere}: choose what happens when it applies.`)
      let value = null
      if (!OPERATORS[entry.operator].noValue) {
        if (fact.unit === 'boolean') {
          if (typeof entry.value !== 'boolean') throw new Error(`${ruleWhere}: choose yes or no.`)
          value = entry.value
        } else {
          value = Number(entry.value)
          if (!Number.isFinite(value)) throw new Error(`${ruleWhere}: enter a number to compare with.`)
        }
      }
      const message = String(entry.message || '').trim().slice(0, 300)
      if (!message) throw new Error(`${ruleWhere}: say what the concern is, for the officer.`)
      let ruleId = String(entry.id || '').slice(0, 40) || `${id}r${ruleIndex + 1}`
      while (ruleIds.has(ruleId)) ruleId = `${ruleId}x`
      ruleIds.add(ruleId)
      return { id: ruleId, fact: entry.fact, operator: entry.operator, value, outcome: entry.outcome, message, enabled: entry.enabled !== false }
    })
    return { id, name, product, enabled: policy.enabled !== false, rules }
  })
}
