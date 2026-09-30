/**
 * The documents generated for an approved loan (Settings → Documents), shared by the API,
 * which renders them, and the workspace, which edits them.
 *
 * Each kind is either written in the workspace (text with {{fields}}, rendered to PDF) or
 * an uploaded PDF. An uploaded PDF's fillable form fields are filled when their names match
 * a field below (with or without the braces, any case); a PDF without fields is used as it
 * is, with a generated summary page added. The customer signs both when accepting.
 */

export const TEMPLATE_KINDS = {
  offer_letter: {
    label: 'Offer letter',
    description: 'The terms you are offering: amount, tenure, cost and conditions. Generated when a loan is approved.',
  },
  loan_agreement: {
    label: 'Loan agreement',
    description: 'The agreement the customer signs when they accept the offer.',
  },
}

export const TEMPLATE_KIND_KEYS = Object.keys(TEMPLATE_KINDS)

/** Fields a template can use, with the sample value the preview shows. */
export const MERGE_FIELDS = [
  { key: 'customer_name', label: 'Customer’s full name', sample: 'Ada Banda' },
  { key: 'customer_nrc', label: 'Customer’s NRC', sample: '123456/78/9' },
  { key: 'customer_email', label: 'Customer’s email', sample: 'ada.banda@example.com' },
  { key: 'customer_phone', label: 'Customer’s phone', sample: '+260 971 234 567' },
  { key: 'customer_address', label: 'Customer’s address', sample: 'Plot 12, Kabulonga, Lusaka' },
  { key: 'company_name', label: 'Business name (business loans)', sample: 'Kafue Agro Supplies Ltd' },
  { key: 'reference', label: 'Application reference', sample: 'LOS-2026-000123' },
  { key: 'product', label: 'Loan product', sample: 'Personal loan' },
  { key: 'amount', label: 'Approved amount', sample: 'K10,000.00' },
  { key: 'tenure', label: 'Tenure', sample: '6 months' },
  { key: 'interest', label: 'Interest rate', sample: '5% flat' },
  { key: 'interest_amount', label: 'Interest in kwacha', sample: 'K500.00' },
  { key: 'facility_fee', label: 'Facility fee', sample: 'K175.00' },
  { key: 'total_repayable', label: 'Total repayable', sample: 'K10,675.00' },
  { key: 'monthly_instalment', label: 'Monthly instalment', sample: 'K1,779.17' },
  { key: 'conditions', label: 'Conditions of the offer', sample: 'Payroll deduction confirmed by the employer.' },
  { key: 'offer_expiry_date', label: 'Date the offer lapses', sample: '14 October 2026' },
  { key: 'decision_date', label: 'Date approved', sample: '30 September 2026' },
  { key: 'approved_by', label: 'Who approved it', sample: 'Mwila Sakala' },
  { key: 'lender_name', label: 'Lender’s name', sample: 'Loan Origination' },
  { key: 'today', label: 'Today’s date', sample: '30 September 2026' },
]

export const MERGE_FIELD_KEYS = MERGE_FIELDS.map((field) => field.key)

/** A PDF form field named "customer_signature" gets the drawn signature; any other form field, its value. */
export const SIGNATURE_FIELD = 'customer_signature'

export const SAMPLE_VALUES = Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, field.sample]))

/** Normalises a PDF form field's name to a merge key: "{{ Customer Name }}" → "customer_name". */
export const fieldKeyFor = (name) =>
  String(name || '')
    .replace(/[{}]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** Replaces {{field}} placeholders. Unknown ones are left visible, so a typo shows in the preview. */
// Fields staff write that may span lines. Everything else — names and addresses the
// applicant typed — is kept to one line, so a line break in it can't start what reads as
// a new clause of the agreement.
const MULTILINE_FIELDS = new Set(['conditions'])

export const fillPlaceholders = (text, values) =>
  String(text || '').replace(/\{\{\s*([a-zA-Z0-9_ ]+?)\s*\}\}/g, (match, name) => {
    const key = fieldKeyFor(name)
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match
    const value = String(values[key] ?? '')
    return MULTILINE_FIELDS.has(key) ? value : value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
  })

/** Placeholders a text template uses that are not merge fields. */
export const unknownPlaceholders = (text) =>
  [...new Set([...String(text || '').matchAll(/\{\{\s*([a-zA-Z0-9_ ]+?)\s*\}\}/g)].map((match) => fieldKeyFor(match[1])))].filter(
    (key) => !MERGE_FIELD_KEYS.includes(key)
  )
