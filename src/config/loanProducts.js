/**
 * Loan products: what each is (marketing copy, the form it uses, the documents and
 * collateral it asks for) and how it is priced.
 *
 * Everything here is the *default*. Administrators change it, and add products, in
 * Settings → Loan products; the stored values are merged over these (api/_lib/products.js on the server,
 * src/hooks/useProducts.js in the browser), so every screen and the server price a
 * loan with the same numbers through priceLoan().
 */

export const DRAFT_RETENTION_DAYS = 7
export const OTP_EXPIRY_MINUTES = 10

export const formatKwacha = (value) => `K${Number(value).toLocaleString()}`

/**
 * Pricing fields, per product:
 *   minAmount / maxAmount       what can be borrowed, in kwacha
 *   minTenure / maxTenure       repayment period bounds, in months
 *   defaultTenure / exampleAmount  what the calculator and marketing copy start from
 *   interestRate                a fraction: 0.05 is 5%
 *   interestBasis               'loan'  — charged once on the amount borrowed (flat)
 *                               'month' — charged every month of the tenure (flat per month)
 *   facilityFee / facilityFeeType  'fixed' kwacha, or 'percent' (a fraction) of the amount
 *   enabled                     off hides the product from applicants
 */
export const DEFAULT_PRICING = {
  personal: {
    enabled: true,
    minAmount: 500,
    maxAmount: 100000,
    exampleAmount: 5000,
    minTenure: 1,
    maxTenure: 24,
    defaultTenure: 6,
    interestRate: 0.05,
    interestBasis: 'loan',
    facilityFee: 175,
    facilityFeeType: 'fixed',
  },
  business: {
    enabled: true,
    minAmount: 5000,
    maxAmount: 500000,
    exampleAmount: 25000,
    minTenure: 1,
    maxTenure: 36,
    defaultTenure: 12,
    interestRate: 0.05,
    interestBasis: 'loan',
    facilityFee: 175,
    facilityFeeType: 'fixed',
  },
}

const round2 = (value) => Math.round(value * 100) / 100

/** The cost of a loan under a product's pricing: interest, fee, total and monthly instalment. */
export const priceLoan = (amount, tenure, pricing = DEFAULT_PRICING.personal) => {
  const principal = Number(amount) || 0
  const months = Math.max(1, Number(tenure) || 1)
  const interest = principal * pricing.interestRate * (pricing.interestBasis === 'month' ? months : 1)
  const fee = pricing.facilityFeeType === 'percent' ? principal * pricing.facilityFee : pricing.facilityFee
  const total = principal + interest + fee
  return { interest: round2(interest), fee: round2(fee), total: round2(total), monthly: round2(total / months) }
}

/** "5% flat" / "3% a month", for labels. */
export const describeInterest = (pricing) =>
  `${round2(pricing.interestRate * 100)}% ${pricing.interestBasis === 'month' ? 'a month' : 'flat'}`

/** "K175" / "2% of the amount", for labels. */
export const describeFee = (pricing) =>
  pricing.facilityFeeType === 'percent' ? `${round2(pricing.facilityFee * 100)}% of the amount` : formatKwacha(pricing.facilityFee)

// Default-pricing shorthands, kept for code that prices with the defaults (tests, demo data).
export const totalRepayable = (amount, tenure = DEFAULT_PRICING.personal.defaultTenure, pricing) => priceLoan(amount, tenure, pricing).total
export const monthlyInstalment = (amount, tenure, pricing) => priceLoan(amount, tenure, pricing).monthly

/**
 * The two application forms a product can use. A product is a name, pricing, documents
 * and collateral rules on top of one of these: the form decides the questions asked, the
 * credit rules that apply (creditRules.js loanTypes) and how the LMS receives it. An
 * application's `loanType` is its product's form; `productId` is the product itself.
 */
export const APPLICANT_FORMS = {
  personal: { label: 'Individual', hint: 'A person: personal details, employment, payslips.', steps: ['Personal information', 'Residence & Employment', 'Documents', 'Loan Terms', 'Overview'] },
  business: { label: 'Company', hint: 'A registered company: business details, directors.', steps: ['Business information', 'Directors & Applicant', 'Documents', 'Loan Terms', 'Overview'] },
}

/**
 * The documents each form knows how to check: the AI reads each by its docType
 * (api/_lib/ai/documents.js) and the credit rules take figures from some of them. A
 * product picks from these, marks each required or optional, and can add its own
 * (slot custom.*, checked against the description the admin gives).
 */
export const DOCUMENT_CATALOGUE = {
  personal: [
    { slot: 'payslips', label: 'Latest three payslips', docType: 'payslips', description: 'Net pay is read from these for affordability.' },
    { slot: 'bankStatements', label: 'Bank statements (3 months)', docType: 'bankStatements', description: 'Money paid in is read from these.' },
    { slot: 'nrcCopy', label: 'NRC copy', docType: 'nrcCopy' },
    { slot: 'tpin', label: 'TPIN certificate', docType: 'tpin' },
    { slot: 'passportPhoto', label: 'Passport-sized photo', docType: 'passportPhoto', photo: true },
  ],
  business: [
    { slot: 'pacraCertificate', label: 'PACRA certificate', docType: 'pacraCertificate' },
    { slot: 'form2', label: 'Form 2', docType: 'form2' },
    { slot: 'taxClearance', label: 'Tax clearance certificate / TPIN', docType: 'taxClearance' },
    { slot: 'latestTaxComplianceReturn', label: 'Latest tax compliance return', docType: 'latestTaxComplianceReturn', description: 'Turnover is read from this.' },
    { slot: 'orderOrInvoice', label: 'Order / invoice', docType: 'orderOrInvoice', description: 'If applying for order financing or invoice discounting.' },
    { slot: 'bankStatements', label: 'Bank statements (6 months)', docType: 'bankStatements', description: 'Money paid in is read from these.' },
    { slot: 'boardResolution', label: 'Board resolution', docType: 'boardResolution' },
    { slot: 'passportPhoto', label: 'Applicant passport-sized photo', docType: 'passportPhoto', photo: true },
  ],
}

const OPTIONAL_BY_DEFAULT = ['orderOrInvoice']

/** A form's catalogue as a product's document list, each required unless it is usually optional. */
export const defaultDocuments = (form) =>
  (DOCUMENT_CATALOGUE[form] || []).map(({ slot, label, docType, description }) => ({ slot, label, docType, description: description || '', required: !OPTIONAL_BY_DEFAULT.includes(slot) }))

/**
 * Collateral a product takes:
 *   requirement   'none' (not asked), 'optional', or 'required' (at least one item)
 *   types         collateral type keys accepted (empty: every active type, collateral.js)
 *   minCoverage   pledged value ÷ loan amount the items must reach (1.2 is 120%), or null
 */
export const DEFAULT_COLLATERAL_RULES = { requirement: 'none', types: [], minCoverage: null }

const BUILT_IN_PRODUCTS = {
  personal: {
    id: 'personal',
    form: 'personal',
    name: 'Personal Loan',
    tagline: 'For salaried applicants',
    description: 'Borrow against your salary for school fees, medical costs, home improvements or any personal need. Repay over a tenure you choose.',
    documents: defaultDocuments('personal'),
    collateral: DEFAULT_COLLATERAL_RULES,
  },
  business: {
    id: 'business',
    form: 'business',
    name: 'Business Loan',
    tagline: 'For registered companies',
    description: 'Working capital for registered Zambian businesses — fund an order, bridge a payment gap, or invest in equipment and stock.',
    documents: defaultDocuments('business'),
    // The business form always asked what was pledged; it stays asked, now itemised.
    collateral: { ...DEFAULT_COLLATERAL_RULES, requirement: 'optional' },
  },
}

export const BUILT_IN_PRODUCT_IDS = Object.keys(BUILT_IN_PRODUCTS)

/** A product id an admin can give a new product: lower-case letters, digits and dashes. */
export const PRODUCT_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

/** What a new product of this form starts as, before the admin's values are laid over it. */
export const productDefaults = (form) => ({
  ...BUILT_IN_PRODUCTS[form],
  ...DEFAULT_PRICING[form],
  id: '',
  name: '',
  tagline: '',
  description: '',
  documents: defaultDocuments(form),
  collateral: DEFAULT_COLLATERAL_RULES,
})

/** The derived fields every screen reads: the form's steps, and the documents' names for marketing copy. */
const finish = (product) => {
  // The AI check type always comes from the catalogue (custom.* documents: "custom"), never from what was stored.
  const catalogue = DOCUMENT_CATALOGUE[product.form]
  const documents = (product.documents || []).map((document) => ({
    description: '',
    ...document,
    required: Boolean(document.required),
    docType: catalogue.find((entry) => entry.slot === document.slot)?.docType || 'custom',
  }))
  return {
    ...product,
    documents,
    steps: APPLICANT_FORMS[product.form].steps,
    requiredDocuments: documents.filter((document) => document.required).map((document) => document.label),
  }
}

/**
 * Products from the stored setting (Settings → Loan products), keyed by id: the two
 * built-in ones always exist (they can be switched off, not removed), each over its own
 * defaults; added ones over the defaults of the form they use. Built-ins first, then
 * added ones in the order they were created.
 */
export const buildProducts = (stored = {}) => {
  const builtIn = BUILT_IN_PRODUCT_IDS.map((id) => finish({ ...BUILT_IN_PRODUCTS[id], ...DEFAULT_PRICING[id], ...(stored[id] || {}), id, form: id }))
  const added = Object.entries(stored)
    .filter(([id, value]) => !BUILT_IN_PRODUCTS[id] && value && APPLICANT_FORMS[value.form])
    .sort(([, a], [, b]) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(([id, value]) => finish({ ...productDefaults(value.form), ...value, id }))
  return [...builtIn, ...added].map((product) => ({ ...product, collateral: { ...DEFAULT_COLLATERAL_RULES, ...(product.collateral || {}) } }))
}

export const LOAN_PRODUCTS = buildProducts()

export const getProduct = (id, products = LOAN_PRODUCTS) => products.find((product) => product.id === id)

/** An application's product: its own, else (applications from before products) the built-in one for its form. */
export const productFor = (application, products = LOAN_PRODUCTS) =>
  getProduct(application?.productId, products) || getProduct(application?.loanType, products) || LOAN_PRODUCTS[0]

/** The four stages an applicant moves through, independent of loan type. */
export const APPLICATION_JOURNEY = [
  {
    title: 'Tell us about you',
    description:
      'Personal and employment details, or your company and director information. Every field is validated as you type, so nothing bounces back later.',
  },
  {
    title: 'Upload your documents',
    description:
      'Attach your supporting documents from your phone or laptop. Each one is checked as you add it, so you can fix a wrong or unclear file straight away.',
  },
  {
    title: 'Take your photo',
    description:
      'Use your device camera for the passport photo. A short check — turn your head, smile, blink — makes sure it is a live photo of you, not a picture of a picture.',
  },
  {
    title: 'Choose terms and submit',
    description:
      'Pick your amount and tenure, review the full repayment breakdown, accept the terms, and submit. You get a reference and can follow progress online.',
  },
]
