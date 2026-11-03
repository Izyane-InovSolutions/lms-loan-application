/**
 * Guarantors: people who promise to repay if the borrower doesn't. A product says whether it
 * asks for them (product.guarantors: { requirement: 'none' | 'optional' | 'required' }); the
 * applicant gives each on the Loan Terms step, at data.guarantors:
 *   [{ name, nrc, phone, email, relationship, address }]
 * Shared by the wizard and the server, so both check the same, and by the case page and the
 * offer letter, which name them.
 */

export const GUARANTOR_REQUIREMENTS = {
  none: { label: 'Not needed', hint: 'Applicants aren’t asked for a guarantor.' },
  optional: { label: 'Optional', hint: 'Applicants may name guarantors.' },
  required: { label: 'Required', hint: 'Applicants must name at least one guarantor.' },
}

export const MAX_GUARANTORS = 3

export const DEFAULT_GUARANTOR_RULES = { requirement: 'none' }

export const RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Other relative', 'Employer', 'Business partner', 'Friend', 'Other']

/** Whether the product asks about guarantors at all. */
export const asksForGuarantors = (product) => ['optional', 'required'].includes(product?.guarantors?.requirement)

/** The guarantors in the form data, cleaned of rows nothing was typed into. */
export const guarantorsOf = (data) =>
  (Array.isArray(data?.guarantors) ? data.guarantors : []).filter((entry) => entry && ['name', 'nrc', 'phone', 'relationship'].some((key) => String(entry[key] || '').trim()))

const NRC_PATTERN = /^\d{6}\/\d{2}\/\d$/
const PHONE_PATTERN = /^\d{9}$/

/** What is wrong with the guarantors for this product, as messages keyed by field (`guarantors`, `guarantors.0.name` …). */
export const guarantorErrors = (product, data) => {
  const errors = {}
  const requirement = product?.guarantors?.requirement || 'none'
  if (requirement === 'none') return errors
  const people = guarantorsOf(data)
  if (requirement === 'required' && !people.length) errors.guarantors = 'This loan needs a guarantor. Add someone who will repay if you can’t.'
  if (people.length > MAX_GUARANTORS) errors.guarantors = `Name at most ${MAX_GUARANTORS} guarantors.`
  people.forEach((person, index) => {
    const at = (field) => `guarantors.${index}.${field}`
    if (String(person.name || '').trim().length < 3) errors[at('name')] = 'Enter their full name.'
    if (!NRC_PATTERN.test(String(person.nrc || '').trim())) errors[at('nrc')] = 'Enter their NRC as 123456/78/9.'
    if (!PHONE_PATTERN.test(String(person.phone || '').replace(/\D/g, '').replace(/^260/, ''))) errors[at('phone')] = 'Enter their 9-digit phone number.'
    if (!RELATIONSHIPS.includes(person.relationship)) errors[at('relationship')] = 'Choose how they know you.'
    if (String(person.address || '').trim().length < 3) errors[at('address')] = 'Enter where they live.'
  })
  return errors
}

/** The guarantors as filed: trimmed, the phone as 9 digits. */
export const cleanGuarantors = (data) =>
  guarantorsOf(data).map((person) => ({
    name: String(person.name).trim().slice(0, 120),
    nrc: String(person.nrc).trim(),
    phone: String(person.phone).replace(/\D/g, '').replace(/^260/, ''),
    email: String(person.email || '').trim().slice(0, 200),
    relationship: person.relationship,
    address: String(person.address).trim().slice(0, 300),
  }))

/** One line for letters and summaries: "Mutale Chanda (NRC 234567/89/1, sibling); …". */
export const describeGuarantors = (data) =>
  guarantorsOf(data)
    .map((person) => `${String(person.name || '').trim()} (NRC ${String(person.nrc || '').trim()}, ${String(person.relationship || '').toLowerCase()})`)
    .join('; ')
