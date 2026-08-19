/**
 * Step identity for the application wizard.
 *
 * Steps are addressable by slug (`/apply/personal/documents`) rather than held in
 * component state, so the browser Back button steps backwards through the form
 * instead of leaving it, a refresh keeps the applicant where they were, and each
 * step can be linked to and measured independently.
 *
 * Slug order must match the step order the wizard validates against — the index
 * of a slug in these arrays *is* `currentStep`.
 */

export const LOAN_TYPES = ['personal', 'business']

export const isLoanType = (value) => LOAN_TYPES.includes(value)

export const STEP_TITLES = {
  personal: ['Personal information', 'Residence & Employment', 'Documents', 'Loan Terms', 'Overview'],
  business: ['Business information', 'Directors & Applicant', 'Documents', 'Loan Terms', 'Overview'],
}

export const STEP_SLUGS = {
  personal: ['personal-information', 'residence-employment', 'documents', 'loan-terms', 'overview'],
  business: ['business-information', 'directors-applicant', 'documents', 'loan-terms', 'overview'],
}

const slugsFor = (type) => STEP_SLUGS[isLoanType(type) ? type : 'personal']

export const stepSlug = (type, index) => {
  const slugs = slugsFor(type)
  return slugs[index] ?? slugs[0]
}

export const stepIndex = (type, slug) => {
  const found = slugsFor(type).indexOf(slug)
  return found === -1 ? 0 : found
}

export const isValidStepSlug = (type, slug) => slugsFor(type).includes(slug)

/** Canonical URL for a given loan type and step index. */
export const applyPath = (type, index = 0) => {
  const safeType = isLoanType(type) ? type : 'personal'
  return `/apply/${safeType}/${stepSlug(safeType, index)}`
}
