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

/**
 * The repayment schedule of a loan paid out on `payoutDate`: one equal instalment a month,
 * the first a month after payout, the last taking up any rounding so they add up to the
 * total repayable. [{ number, due (Date), amount, balance }].
 */
export const repaymentSchedule = (amount, tenure, pricing, payoutDate = new Date()) => {
  const { total, monthly } = priceLoan(amount, tenure, pricing)
  const months = Math.max(1, Number(tenure) || 1)
  const start = new Date(payoutDate)
  let balance = total
  return Array.from({ length: months }, (_, index) => {
    const due = new Date(start)
    due.setMonth(start.getMonth() + index + 1)
    // A payout on the 31st falls due on the last day of a shorter month, not in the next one.
    if (due.getDate() !== start.getDate()) due.setDate(0)
    const instalment = index === months - 1 ? round2(balance) : monthly
    balance = round2(balance - instalment)
    return { number: index + 1, due, amount: instalment, balance: Math.max(0, balance) }
  })
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
 *   requirement   'none' (not asked), 'optional', 'required' (at least one item), or
 *                 'amount' (required from requiredFrom up, not asked below it)
 *   requiredFrom  the loan amount, in kwacha, from which 'amount' asks; else null
 *   types         collateral type keys accepted (empty: every active type, collateral.js)
 *   mustCover     when required, the pledges' lending value (after haircut and
 *                 loan-to-value) must reach the loan amount
 */
export const DEFAULT_COLLATERAL_RULES = { requirement: 'none', requiredFrom: null, types: [], mustCover: false }

// Rules saved before lending values: a minimum cover stood for "must cover the loan".
const collateralRules = ({ minCoverage, ...rules } = {}) => ({
  ...DEFAULT_COLLATERAL_RULES,
  ...(rules.mustCover === undefined && Number(minCoverage) > 0 ? { mustCover: true } : {}),
  ...rules,
})

/**
 * Loan categories (stored as loan types): how loans are grouped for applicants, first by who
 * borrows (Settings → Loan products → Loan categories), then by sub category. Applicants choose
 * a category, then a sub category, then one of its products. Each category uses one of the two
 * application forms, fixed once made, and every product belongs to a category that uses its
 * own form, and to one of that category's sub categories. A category or sub category is deleted
 * only once no product belongs to it.
 *   { key, label, description, form, subcategories: [{ key, label, description }] }
 */
export const DEFAULT_SUBCATEGORIES = {
  personal: [
    { key: 'asset', label: 'Asset loans', description: 'To buy an asset you own — a vehicle or a home — usually pledged against the loan.' },
    { key: 'non-asset', label: 'Non-asset loans', description: 'For needs like school fees, medical costs or bills, with nothing bought to pledge.' },
  ],
  business: [
    { key: 'asset-finance', label: 'Asset & investment finance', description: 'Equipment, vehicles, premises and longer-term investment in the business.' },
    { key: 'working-capital', label: 'Working capital', description: 'Stock, wages, orders and the day-to-day cash flow of the business.' },
  ],
}

export const DEFAULT_LOAN_TYPES = [
  { key: 'personal', label: 'Personal loans', description: 'Borrowed by an individual for personal, family or household needs.', form: 'personal', subcategories: DEFAULT_SUBCATEGORIES.personal },
  { key: 'business', label: 'Business loans', description: 'Borrowed for business expenses, investment or growth.', form: 'business', subcategories: DEFAULT_SUBCATEGORIES.business },
]

/** A loan category or sub category key: lower-case letters, digits and dashes. */
export const LOAN_TYPE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

// A category saved before sub categories: the defaults for the two standard ones, else one general sub category.
const subcategoriesFor = (type) => {
  if (Array.isArray(type.subcategories) && type.subcategories.length) return type.subcategories.map(({ key, label, description }) => ({ key, label, description: description || '' }))
  return DEFAULT_SUBCATEGORIES[type.key] || [{ key: 'general', label: type.label, description: type.description || '' }]
}

/** The workspace's loan categories as stored (the defaults until any are saved), each on a known form, with its sub categories. */
export const buildLoanTypes = (stored) =>
  (Array.isArray(stored?.types) ? stored.types : DEFAULT_LOAN_TYPES)
    .filter((type) => type && APPLICANT_FORMS[type.form])
    .map((type) => ({ key: type.key, label: type.label, description: type.description || '', form: type.form, subcategories: subcategoriesFor(type) }))

// The sub category each standard purpose belongs to in the default categories.
const PURPOSE_SUBCATEGORY = {
  vehicle: 'asset',
  home: 'asset',
  business_term: 'asset-finance',
  asset_finance: 'asset-finance',
  commercial_property: 'asset-finance',
}

/** A product's sub category: its own, if its category still has it, else the category's first. Null for an unknown category. */
export const subcategoryOf = (product, loanTypes) => {
  const type = loanTypes.find((entry) => entry.key === product?.loanType)
  if (!type) return null
  return type.subcategories.find((entry) => entry.key === product.subcategory) || type.subcategories[0]
}

/**
 * What a loan is for, by who borrows (its application form). A product names one, or none
 * (general purpose). The purpose is a label for applicants and reports; what the product
 * asks and how it decides comes from its own settings.
 */
export const LOAN_PURPOSES = {
  personal: [
    { key: 'unsecured', label: 'Unsecured personal loan', description: 'General-purpose borrowing without collateral.' },
    { key: 'vehicle', label: 'Vehicle loan', description: 'To buy a car, motorcycle or other vehicle.' },
    { key: 'home', label: 'Home loan or mortgage', description: 'To buy, build or renovate a home.' },
    { key: 'education', label: 'Education loan', description: 'To pay for tuition or related study costs.' },
    { key: 'medical', label: 'Medical loan', description: 'To cover healthcare costs.' },
    { key: 'debt_consolidation', label: 'Debt-consolidation loan', description: 'To combine existing debts into one repayment.' },
    { key: 'personal_credit_line', label: 'Personal line of credit', description: 'Reusable borrowing up to an approved limit.' },
  ],
  business: [
    { key: 'working_capital', label: 'Working-capital loan', description: 'Day-to-day expenses such as wages or supplies.' },
    { key: 'business_term', label: 'Business term loan', description: 'A lump sum repaid over a set period.' },
    { key: 'business_credit_line', label: 'Business line of credit', description: 'Reusable funds for changing cash-flow needs.' },
    { key: 'asset_finance', label: 'Equipment or asset-finance loan', description: 'To buy machinery, vehicles or other business assets.' },
    { key: 'commercial_property', label: 'Commercial property loan', description: 'To buy, build or improve business premises.' },
    { key: 'inventory_invoice', label: 'Inventory or invoice-finance loan', description: 'To fund stock, or borrow against unpaid invoices.' },
    { key: 'startup_micro', label: 'Business start-up or microloan', description: 'Smaller financing for a new or small business.' },
  ],
}

export const purposeOf = (product) => (LOAN_PURPOSES[product?.form] || []).find((purpose) => purpose.key === product?.purpose) || null

export const INTEREST_TYPES = { fixed: 'Fixed rate', variable: 'Variable rate' }

/**
 * Who qualifies (src/config/eligibility.js), per product:
 *   minIncome        no longer set here: who qualifies by income is decided by the policies'
 *                    "Not eligible for…" rules (net pay bands). Kept as null; one saved
 *                    before is moved into the published policy (rulesets.js).
 *   repaymentShare   the most of that income all loan repayments may take, this one
 *                    included (0.4 is 40%); it sets the largest loan they can afford
 */
export const DEFAULT_ELIGIBILITY = {
  personal: { minIncome: null, repaymentShare: 0.4 },
  business: { minIncome: null, repaymentShare: 0.3 },
}

const BUILT_IN_PRODUCTS = {
  personal: {
    id: 'personal',
    form: 'personal',
    name: 'Personal Loan',
    tagline: 'For salaried applicants',
    description: 'Borrow against your salary for school fees, medical costs, home improvements or any personal need. Repay over a tenure you choose.',
    documents: defaultDocuments('personal'),
    collateral: DEFAULT_COLLATERAL_RULES,
    subcategory: 'non-asset',
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
    subcategory: 'working-capital',
  },
}

export const BUILT_IN_PRODUCT_IDS = Object.keys(BUILT_IN_PRODUCTS)

// One standard product per purpose: [form, purpose, id, name, tagline, amounts, tenures (months),
// monthly interest, collateral, eligibility]. Every workspace has them, switched off until an
// administrator has checked the pricing and switched them on; they can be changed like any other.
const percentFee = { facilityFee: 0.02, facilityFeeType: 'percent' }
const secured = (types, extra = {}) => ({ ...DEFAULT_COLLATERAL_RULES, requirement: 'required', types, mustCover: true, ...extra })
const STANDARD = [
  ['personal', 'unsecured', 'unsecured-personal-loan', 'Unsecured Personal Loan', 'Borrow without collateral', [500, 50000, 5000], [1, 24, 12], 0.04, DEFAULT_COLLATERAL_RULES, 2000],
  ['personal', 'vehicle', 'vehicle-loan', 'Vehicle Loan', 'For a car, motorcycle or other vehicle', [10000, 500000, 150000], [12, 60, 36], 0.025, secured(['motor_vehicle']), 5000],
  ['personal', 'home', 'home-loan', 'Home Loan', 'Buy, build or renovate a home', [50000, 2000000, 400000], [60, 240, 120], 0.015, secured(['land_buildings']), 10000],
  ['personal', 'education', 'education-loan', 'Education Loan', 'Tuition and study costs', [1000, 100000, 15000], [3, 36, 12], 0.03, DEFAULT_COLLATERAL_RULES, 2000],
  ['personal', 'medical', 'medical-loan', 'Medical Loan', 'Healthcare costs, when they come', [500, 50000, 5000], [1, 24, 6], 0.035, DEFAULT_COLLATERAL_RULES, 1500],
  ['personal', 'debt_consolidation', 'debt-consolidation-loan', 'Debt-Consolidation Loan', 'Combine what you owe into one repayment', [5000, 200000, 30000], [6, 48, 24], 0.03, DEFAULT_COLLATERAL_RULES, 3000],
  ['personal', 'personal_credit_line', 'personal-line-of-credit', 'Personal Line of Credit', 'Reusable borrowing up to a limit', [1000, 50000, 10000], [1, 12, 6], 0.04, DEFAULT_COLLATERAL_RULES, 3000],
  ['business', 'working_capital', 'working-capital-loan', 'Working-Capital Loan', 'Wages, supplies and day-to-day costs', [5000, 500000, 50000], [1, 12, 6], 0.04, { ...DEFAULT_COLLATERAL_RULES, requirement: 'optional' }, 20000],
  ['business', 'business_term', 'business-term-loan', 'Business Term Loan', 'A lump sum over a set period', [20000, 2000000, 200000], [12, 60, 36], 0.03, { ...DEFAULT_COLLATERAL_RULES, requirement: 'amount', requiredFrom: 250000, mustCover: true }, 50000],
  ['business', 'business_credit_line', 'business-line-of-credit', 'Business Line of Credit', 'Funds for changing cash flow', [10000, 500000, 50000], [1, 12, 6], 0.04, { ...DEFAULT_COLLATERAL_RULES, requirement: 'optional' }, 30000],
  ['business', 'asset_finance', 'asset-finance-loan', 'Equipment & Asset Finance', 'Machinery, vehicles and business assets', [20000, 2000000, 250000], [12, 60, 36], 0.025, secured(['equipment', 'motor_vehicle']), 50000],
  ['business', 'commercial_property', 'commercial-property-loan', 'Commercial Property Loan', 'Buy, build or improve premises', [100000, 5000000, 1000000], [60, 240, 120], 0.015, secured(['land_buildings']), 100000],
  ['business', 'inventory_invoice', 'inventory-invoice-finance', 'Inventory & Invoice Finance', 'Fund stock, or borrow against invoices', [5000, 1000000, 100000], [1, 6, 3], 0.04, { ...DEFAULT_COLLATERAL_RULES, requirement: 'optional', types: ['stock', 'receivables'] }, 30000],
  ['business', 'startup_micro', 'business-microloan', 'Start-Up & Microloan', 'Smaller financing for new and small businesses', [1000, 50000, 10000], [1, 12, 6], 0.05, DEFAULT_COLLATERAL_RULES, 2000],
]

/**
 * The minimum income each standard product asked for before the policies' net pay bands took
 * that over: moved into the published policy once, for workspaces that had them (rulesets.js).
 */
export const FORMER_STANDARD_MIN_INCOME = Object.fromEntries(STANDARD.map((entry) => [entry[2], entry[9]]))

export const STANDARD_PRODUCTS = Object.fromEntries(
  STANDARD.map(([form, purpose, id, name, tagline, [minAmount, maxAmount, exampleAmount], [minTenure, maxTenure, defaultTenure], rate, collateral]) => [
    id,
    {
      form,
      purpose,
      name,
      tagline,
      description: LOAN_PURPOSES[form].find((entry) => entry.key === purpose).description,
      enabled: false,
      minAmount,
      maxAmount,
      exampleAmount,
      minTenure,
      maxTenure,
      defaultTenure,
      interestRate: rate,
      interestBasis: 'month',
      ...percentFee,
      collateral,
      // Who qualifies by income is the policy's (Policy rules → "Not eligible for…" net pay bands).
      eligibility: { ...DEFAULT_ELIGIBILITY[form], minIncome: null },
      loanType: form,
      subcategory: PURPOSE_SUBCATEGORY[purpose] || (form === 'personal' ? 'non-asset' : 'working-capital'),
      // After the built-in two, before anything a workspace adds from today.
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ])
)

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
  purpose: null,
  interestType: 'fixed',
  eligibility: DEFAULT_ELIGIBILITY[form],
  subcategory: null,
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
    purpose: null,
    interestType: 'fixed',
    ...product,
    // The loan type it belongs to: the built-in type of its form until one is chosen.
    loanType: product.loanType || product.form,
    // Its sub category in that loan type (subcategoryOf falls back to the type's first).
    subcategory: product.subcategory || null,
    // Whether applicants name guarantors (src/config/guarantors.js).
    guarantors: { requirement: 'none', ...(product.guarantors || {}) },
    // Deleted, but applications were made under it: kept so they still read, never offered.
    deleted: Boolean(product.deleted),
    enabled: product.deleted ? false : Boolean(product.enabled),
    eligibility: { ...DEFAULT_ELIGIBILITY[product.form], ...(product.eligibility || {}) },
    documents,
    steps: APPLICANT_FORMS[product.form].steps,
    requiredDocuments: documents.filter((document) => document.required).map((document) => document.label),
  }
}

/**
 * Products from the stored setting (Settings → Loan products), keyed by id: the two
 * built-in ones and the standard ones (STANDARD_PRODUCTS, off until switched on) exist
 * over their own defaults until deleted; added ones lie over the defaults of the form they
 * use. Built-ins first, then the rest in the order they were created.
 *
 * Deleting stores null for a product no application used (gone, defaults included), or
 * marks it `deleted` when applications were made under it (kept for them, see
 * liveProducts). Every list the workspace edits or offers uses liveProducts.
 */
export const buildProducts = (stored = {}) => {
  const builtIn = BUILT_IN_PRODUCT_IDS.filter((id) => stored[id] !== null).map((id) => finish({ ...BUILT_IN_PRODUCTS[id], ...DEFAULT_PRICING[id], ...(stored[id] || {}), id, form: id }))
  const added = Object.entries({ ...STANDARD_PRODUCTS, ...stored })
    .filter(([id, value]) => !BUILT_IN_PRODUCTS[id] && value && APPLICANT_FORMS[value.form || STANDARD_PRODUCTS[id]?.form])
    .map(([id, value]) => [id, { ...(STANDARD_PRODUCTS[id] || {}), ...value }])
    .sort(([, a], [, b]) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(([id, value]) => finish({ ...productDefaults(value.form), ...value, id }))
  return [...builtIn, ...added].map((product) => ({ ...product, collateral: collateralRules(product.collateral) }))
}

/**
 * "We'll match you": the application an applicant fills in for a loan type before choosing a
 * product (id match-<loan type>). It asks the documents every product of the type on offer
 * requires, and the income evidence matching reads (payslips, or bank statements for a
 * business); the product-eligibility rules then say which products they qualify for
 * (productEligibility.js). Never stored or submitted: on choosing, the application becomes
 * the chosen product's, and any extra documents it needs are asked for then.
 */
export const MATCHING_PREFIX = 'match-'
export const isMatchingId = (id) => String(id || '').startsWith(MATCHING_PREFIX)

export const matchingProduct = (loanType, products) => {
  const offered = products.filter((product) => product.enabled && !product.deleted && product.loanType === loanType.key)
  if (!offered.length) return null
  const { form } = loanType
  const required = (product, slot) => product.documents.some((document) => document.slot === slot && document.required)
  const common = offered[0].documents.filter((document) => document.required && offered.every((product) => required(product, document.slot)))
  const incomeSlot = form === 'personal' ? 'payslips' : 'bankStatements'
  const incomeDocument = DOCUMENT_CATALOGUE[form].find((entry) => entry.slot === incomeSlot)
  const documents = common.some((document) => document.slot === incomeSlot)
    ? common
    : [...common, { slot: incomeSlot, label: incomeDocument.label, docType: incomeDocument.docType, description: 'We read your income from these to match you to a loan.', required: true }]
  return finish({
    ...productDefaults(form),
    ...DEFAULT_PRICING[form],
    id: `${MATCHING_PREFIX}${loanType.key}`,
    name: loanType.label,
    tagline: 'We’ll match you to a loan',
    description: loanType.description,
    form,
    loanType: loanType.key,
    matching: true,
    enabled: true,
    minAmount: Math.min(...offered.map((product) => product.minAmount)),
    maxAmount: Math.max(...offered.map((product) => product.maxAmount)),
    documents,
    collateral: DEFAULT_COLLATERAL_RULES,
  })
}

/** The products that exist for the workspace: deleted ones (kept only for their applications) left out. */
export const liveProducts = (products) => products.filter((product) => !product.deleted)

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
