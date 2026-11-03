/**
 * Collateral: what the lender accepts as security (Settings → Loan products), and the
 * checks a product's collateral rules make on what an applicant pledges. Shared by the
 * wizard, the server and the case page, so all three agree on what is enough.
 *
 * The lender sets up two lists, together "the catalog" ({ types, items }):
 *   types   { key, label, haircut, ltv, retired }: a class of security and how it is valued.
 *           haircut is the fraction knocked off the stated value (0.3 is 30%); ltv the
 *           fraction of what is left that can be lent against (0.7 is 70%).
 *   items   { code, type, name, retired }: what applicants pick from, each of one type,
 *           whose haircut and loan-to-value it takes.
 * Retired entries stay readable on old applications, but can't be picked.
 *
 * An application's pledges are `data.collateral.items`: [{ code, type, description, value }],
 * value being the applicant's own estimate. On submission the server stamps each with its
 * item's name and its type's haircut and ltv, so later changes to the catalog don't
 * revalue old applications. An optional proof document each is at documents.collateral.{index}
 * (slot collateral.{index}). Applications from before items have only { type, description, value }.
 */

import { formatKwacha } from './loanProducts.js'

export const DEFAULT_COLLATERAL_TYPES = [
  { key: 'land_buildings', label: 'Land and buildings', haircut: 0.2, ltv: 0.8, retired: false },
  { key: 'motor_vehicle', label: 'Motor vehicle', haircut: 0.3, ltv: 0.7, retired: false },
  { key: 'equipment', label: 'Equipment and machinery', haircut: 0.4, ltv: 0.6, retired: false },
  { key: 'stock', label: 'Stock / inventory', haircut: 0.5, ltv: 0.5, retired: false },
  { key: 'cash_deposit', label: 'Cash or fixed deposit', haircut: 0, ltv: 0.9, retired: false },
  { key: 'receivables', label: 'Receivables / invoices', haircut: 0.4, ltv: 0.6, retired: false },
  { key: 'other', label: 'Other', haircut: 0.5, ltv: 0.5, retired: false },
]

export const DEFAULT_COLLATERAL_ITEMS = [
  { code: 'LB-RES', type: 'land_buildings', name: 'Residential property', retired: false },
  { code: 'LB-COM', type: 'land_buildings', name: 'Commercial property', retired: false },
  { code: 'LB-PLOT', type: 'land_buildings', name: 'Vacant plot', retired: false },
  { code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', retired: false },
  { code: 'MV-COM', type: 'motor_vehicle', name: 'Commercial vehicle or truck', retired: false },
  { code: 'EQ-MCH', type: 'equipment', name: 'Equipment and machinery', retired: false },
  { code: 'ST-INV', type: 'stock', name: 'Stock / inventory', retired: false },
  { code: 'CD-FD', type: 'cash_deposit', name: 'Fixed deposit', retired: false },
  { code: 'RC-INV', type: 'receivables', name: 'Unpaid invoices', retired: false },
  { code: 'OT-OTH', type: 'other', name: 'Other asset', retired: false },
]

export const DEFAULT_COLLATERAL_CATALOG = { types: DEFAULT_COLLATERAL_TYPES, items: DEFAULT_COLLATERAL_ITEMS }

/** A collateral item code: capitals, digits, dashes and underscores, 2 to 20 of them. */
export const COLLATERAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/

const fraction = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback)

/**
 * The catalog as stored, made whole: types saved before haircuts existed take their
 * default's (or none: 0% haircut, 100% loan-to-value), and items whose type is gone are dropped.
 */
export const buildCollateralCatalog = (stored = {}) => {
  const types = (Array.isArray(stored.types) ? stored.types : DEFAULT_COLLATERAL_TYPES).map((type) => {
    const known = DEFAULT_COLLATERAL_TYPES.find((entry) => entry.key === type.key)
    return { key: type.key, label: type.label, haircut: fraction(type.haircut, known?.haircut ?? 0), ltv: fraction(type.ltv, known?.ltv ?? 1), retired: Boolean(type.retired) }
  })
  const items = (Array.isArray(stored.items) ? stored.items : DEFAULT_COLLATERAL_ITEMS)
    .filter((item) => types.some((type) => type.key === item.type))
    .map((item) => ({ code: item.code, type: item.type, name: item.name, retired: Boolean(item.retired) }))
  return { types, items }
}

/** The catalog applicants see: active items of active types, and those types. */
export const activeCatalog = (catalog) => {
  const types = catalog.types.filter((type) => !type.retired)
  return { types, items: catalog.items.filter((item) => !item.retired && types.some((type) => type.key === item.type)) }
}

/**
 * How a product decides whether to ask:
 *   none / optional / required   the same for every amount
 *   amount                       required from `requiredFrom` kwacha up; smaller loans aren't asked
 */
export const COLLATERAL_REQUIREMENTS = {
  none: { label: 'Not needed', hint: 'Applicants aren’t asked about collateral.' },
  optional: { label: 'Optional', hint: 'Applicants may pledge collateral.' },
  required: { label: 'Required', hint: 'Applicants must pledge at least one item.' },
  amount: { label: 'By loan amount', hint: 'Required from an amount you set; smaller loans aren’t asked.' },
}

export const MAX_COLLATERAL_ITEMS = 5

/** What the product asks of a loan of this amount: 'none', 'optional' or 'required'. */
export const collateralRequirement = (product, amount) => {
  const rules = product?.collateral || {}
  if (rules.requirement === 'amount') return Number(rules.requiredFrom) > 0 && Number(amount) >= Number(rules.requiredFrom) ? 'required' : 'none'
  return ['optional', 'required'].includes(rules.requirement) ? rules.requirement : 'none'
}

/** Whether the product asks for collateral on any loan. */
export const asksForCollateral = (product) => Boolean(COLLATERAL_REQUIREMENTS[product?.collateral?.requirement]) && product.collateral.requirement !== 'none'

/** "Required", "Optional", "Required from K50,000", for labels. */
export const describeRequirement = (product) => {
  const rules = product?.collateral || {}
  if (rules.requirement === 'amount') return `Required from ${formatKwacha(rules.requiredFrom)}`
  return COLLATERAL_REQUIREMENTS[rules.requirement]?.label || COLLATERAL_REQUIREMENTS.none.label
}

/** The items a product accepts: active ones of its accepted types (every active type when it names none). */
export const acceptedItems = (product, catalog = DEFAULT_COLLATERAL_CATALOG) => {
  const { items } = activeCatalog(catalog)
  const named = product?.collateral?.types || []
  return named.length ? items.filter((item) => named.includes(item.type)) : items
}

export const typeLabel = (key, catalog = DEFAULT_COLLATERAL_CATALOG) => catalog.types.find((type) => type.key === key)?.label || key || 'Collateral'

/** A pledge's item: what it was stamped with on submission, else the catalog's, else (older pledges) its type's name. */
export const itemLabel = (pledge, catalog = DEFAULT_COLLATERAL_CATALOG) =>
  pledge?.name || catalog.items.find((item) => item.code === pledge?.code)?.name || typeLabel(pledge?.type, catalog)

/** A pledge's { haircut, ltv }: stamped on submission, else from its type in the catalog (none known: taken at face value). */
export const pledgeTerms = (pledge, catalog = DEFAULT_COLLATERAL_CATALOG) => {
  const typeKey = catalog.items.find((item) => item.code === pledge?.code)?.type || pledge?.type
  const type = catalog.types.find((entry) => entry.key === typeKey)
  return { haircut: fraction(pledge?.haircut, type?.haircut ?? 0), ltv: fraction(pledge?.ltv, type?.ltv ?? 1) }
}

const round2 = (value) => Math.round(value * 100) / 100

/** What can be lent against a pledge: its stated value, less the haircut, times the loan-to-value. */
export const lendingValue = (pledge, catalog = DEFAULT_COLLATERAL_CATALOG) => {
  const value = Number(pledge?.value) > 0 ? Number(pledge.value) : 0
  const { haircut, ltv } = pledgeTerms(pledge, catalog)
  return round2(value * (1 - haircut) * ltv)
}

/** "30% haircut · 70% LTV", for labels. */
export const describeTerms = ({ haircut, ltv }) => `${round2(haircut * 100)}% haircut · ${round2(ltv * 100)}% LTV`

/** The items pledged in an application's form data, cleaned of half-filled rows. */
export const collateralItems = (data) =>
  (Array.isArray(data?.collateral?.items) ? data.collateral.items : []).filter(
    (item) => item && (item.code || item.type || String(item.description || '').trim() || Number(item.value) > 0)
  )

/**
 * Appraisal (applications.valuations, by item index): a pledge as the lender values it — the
 * valuer's market value once appraised, else the applicant's own estimate. `statedValue`
 * keeps the estimate; `valued` says which it is.
 */
export const appraisedPledge = (pledge, valuation) =>
  Number(valuation?.marketValue) > 0 ? { ...pledge, statedValue: pledge.value, value: Number(valuation.marketValue), valued: true } : { ...pledge, statedValue: pledge.value, valued: false }

/** The pledged items, each as appraised. */
export const appraisedItems = (data, valuations) => collateralItems(data).map((item, index) => appraisedPledge(item, valuations?.[index]))

/** Total estimated value pledged, in kwacha (0 when none). */
export const collateralValue = (items) => items.reduce((sum, item) => sum + (Number(item.value) > 0 ? Number(item.value) : 0), 0)

/** Total lending value of the pledges, in kwacha (0 when none). */
export const collateralLendingValue = (items, catalog = DEFAULT_COLLATERAL_CATALOG) => round2(items.reduce((sum, item) => sum + lendingValue(item, catalog), 0))

/**
 * What is wrong with the pledges for this product and amount, as messages for the
 * applicant keyed by field (`collateral` for the whole, `collateral.items.0.value` …).
 * Empty when they are fine.
 */
export const collateralErrors = (product, data, amount, catalog = DEFAULT_COLLATERAL_CATALOG) => {
  const errors = {}
  const requirement = collateralRequirement(product, amount)
  if (requirement === 'none') return errors
  const items = collateralItems(data)
  const accepted = acceptedItems(product, catalog).map((item) => item.code)
  if (requirement === 'required' && !items.length) errors.collateral = 'This loan needs collateral. Add at least one item you are pledging.'
  if (items.length > MAX_COLLATERAL_ITEMS) errors.collateral = `Pledge at most ${MAX_COLLATERAL_ITEMS} items.`
  items.forEach((item, index) => {
    if (!accepted.includes(item.code)) errors[`collateral.items.${index}.code`] = 'Choose what you are pledging.'
    if (String(item.description || '').trim().length < 3) errors[`collateral.items.${index}.description`] = 'Describe the item, e.g. make and registration, or plot number.'
    if (!(Number(item.value) > 0)) errors[`collateral.items.${index}.value`] = 'Enter its estimated value in kwacha.'
  })
  // When the product says so, what can be lent against the pledges must reach the loan.
  if (requirement === 'required' && product.collateral?.mustCover && items.length && Number(amount) > 0 && !errors.collateral) {
    const lending = collateralLendingValue(items, catalog)
    if (lending < Number(amount)) {
      errors.collateral = `The collateral’s lending value must reach the loan amount, ${formatKwacha(amount)}. After haircuts and loan-to-value it comes to ${formatKwacha(lending)}.`
    }
  }
  return errors
}

/** The pledges as filed: each with its item's type and name, and its type's haircut and loan-to-value as they are now. */
export const stampCollateral = (data, catalog) =>
  collateralItems(data).map((pledge) => {
    const item = catalog.items.find((entry) => entry.code === pledge.code)
    const { haircut, ltv } = pledgeTerms({ code: pledge.code }, catalog)
    return { code: pledge.code, type: item.type, name: item.name, description: String(pledge.description || '').trim(), value: Number(pledge.value), haircut, ltv }
  })

/** One line for the LMS and summaries: "Passenger vehicle: Toyota Hilux ABC 1234 (K180,000); …". */
export const describeCollateral = (data, catalog = DEFAULT_COLLATERAL_CATALOG) =>
  collateralItems(data)
    .map((item) => `${itemLabel(item, catalog)}: ${String(item.description || '').trim()}${Number(item.value) > 0 ? ` (${formatKwacha(item.value)})` : ''}`)
    .join('; ')
