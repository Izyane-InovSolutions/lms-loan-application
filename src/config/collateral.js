/**
 * Collateral: the kinds of security the lender accepts (Settings → Loan products →
 * Collateral types), and the checks a product's collateral rules make on what an
 * applicant pledges. Shared by the wizard, the server and the case page, so all three
 * agree on what is enough.
 *
 * An application's pledges are `data.collateral.items`: [{ type, description, value }],
 * with an optional proof document each at documents.collateral.{index} (slot collateral.{index}).
 */

import { formatKwacha } from './loanProducts.js'

/** A type: { key, label, description, retired }. Retired types stay readable on old applications, but can't be picked. */
export const DEFAULT_COLLATERAL_TYPES = [
  { key: 'land_buildings', label: 'Land and buildings', description: 'Title deed, or certificate of title, for a plot or property.', retired: false },
  { key: 'motor_vehicle', label: 'Motor vehicle', description: 'Vehicle registration (white book) in the applicant’s name.', retired: false },
  { key: 'equipment', label: 'Equipment and machinery', description: 'Invoices or a valuation for the equipment.', retired: false },
  { key: 'stock', label: 'Stock / inventory', description: 'A stock list or recent valuation.', retired: false },
  { key: 'cash_deposit', label: 'Cash or fixed deposit', description: 'A deposit certificate or bank letter.', retired: false },
  { key: 'receivables', label: 'Receivables / invoices', description: 'Unpaid invoices from reliable customers.', retired: false },
  { key: 'other', label: 'Other', description: 'Anything else of value; describe it.', retired: false },
]

export const COLLATERAL_REQUIREMENTS = {
  none: { label: 'Not needed', hint: 'Applicants aren’t asked about collateral.' },
  optional: { label: 'Optional', hint: 'Applicants may pledge collateral.' },
  required: { label: 'Required', hint: 'Applicants must pledge at least one item.' },
}

export const MAX_COLLATERAL_ITEMS = 5

/** The type keys a product accepts, from the active types (all of them when it names none). */
export const acceptedTypes = (product, types = DEFAULT_COLLATERAL_TYPES) => {
  const active = types.filter((type) => !type.retired)
  const named = product?.collateral?.types || []
  return named.length ? active.filter((type) => named.includes(type.key)) : active
}

export const typeLabel = (key, types = DEFAULT_COLLATERAL_TYPES) => types.find((type) => type.key === key)?.label || key || 'Collateral'

/** The items pledged in an application's form data, cleaned of half-filled rows. */
export const collateralItems = (data) =>
  (Array.isArray(data?.collateral?.items) ? data.collateral.items : []).filter((item) => item && (item.type || String(item.description || '').trim() || Number(item.value) > 0))

/** Total estimated value pledged, in kwacha (0 when none). */
export const collateralValue = (items) => items.reduce((sum, item) => sum + (Number(item.value) > 0 ? Number(item.value) : 0), 0)

/**
 * What is wrong with the pledges for this product and amount, as messages for the
 * applicant keyed by field (`collateral` for the whole, `collateral.items.0.value` …).
 * Empty when they are fine.
 */
export const collateralErrors = (product, data, amount, types = DEFAULT_COLLATERAL_TYPES) => {
  const rules = product?.collateral || {}
  const errors = {}
  if (!rules.requirement || rules.requirement === 'none') return errors
  const items = collateralItems(data)
  const accepted = acceptedTypes(product, types).map((type) => type.key)
  if (rules.requirement === 'required' && !items.length) errors.collateral = 'This loan needs collateral. Add at least one item you are pledging.'
  if (items.length > MAX_COLLATERAL_ITEMS) errors.collateral = `Pledge at most ${MAX_COLLATERAL_ITEMS} items.`
  items.forEach((item, index) => {
    if (!accepted.includes(item.type)) errors[`collateral.items.${index}.type`] = 'Choose what kind of collateral this is.'
    if (String(item.description || '').trim().length < 3) errors[`collateral.items.${index}.description`] = 'Describe the item, e.g. make and registration, or plot number.'
    if (!(Number(item.value) > 0)) errors[`collateral.items.${index}.value`] = 'Enter its estimated value in kwacha.'
  })
  const cover = Number(rules.minCoverage)
  if (items.length && cover > 0 && Number(amount) > 0 && !errors.collateral) {
    const needed = Math.ceil(Number(amount) * cover)
    if (collateralValue(items) < needed) errors.collateral = `The collateral must be worth at least ${formatKwacha(needed)} (${Math.round(cover * 100)}% of the loan). It adds up to ${formatKwacha(collateralValue(items))}.`
  }
  return errors
}

/** One line for the LMS and summaries: "Motor vehicle: Toyota Hilux ABC 1234 (K180,000); …". */
export const describeCollateral = (data, types = DEFAULT_COLLATERAL_TYPES) =>
  collateralItems(data)
    .map((item) => `${typeLabel(item.type, types)}: ${String(item.description || '').trim()}${Number(item.value) > 0 ? ` (${formatKwacha(item.value)})` : ''}`)
    .join('; ')
