/**
 * Loan products: what each is (marketing copy, steps, documents) and how it is priced.
 *
 * Pricing here is the *default*. Administrators change it in Settings → Loan products;
 * the stored values are merged over these (api/_lib/products.js on the server,
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

const DESCRIPTIONS = [
  {
    id: 'personal',
    name: 'Personal Loan',
    tagline: 'For salaried applicants',
    description:
      'Borrow against your salary for school fees, medical costs, home improvements or any personal need. Repay over a tenure you choose.',
    steps: ['Personal information', 'Residence & Employment', 'Documents', 'Loan Terms', 'Overview'],
    documents: ['Salary Slip', 'Bank Statement', 'NRC Copy', 'Passport Photo', 'TPIN Certificate'],
  },
  {
    id: 'business',
    name: 'Business Loan',
    tagline: 'For registered companies',
    description:
      'Working capital for registered Zambian businesses — fund an order, bridge a payment gap, or invest in equipment and stock.',
    steps: ['Business information', 'Directors & Applicant', 'Documents', 'Loan Terms', 'Overview'],
    documents: [
      'PACRA Certificate',
      'Form 2',
      'Latest Tax Compliance Return',
      'Order/Invoice',
      'Tax Clearance Certificate',
      'Bank Statements',
      'Passport Photo',
      'Board Resolution',
    ],
  },
]

/** Products with the given pricing (defaults when none is passed). */
export const buildProducts = (pricing = DEFAULT_PRICING) =>
  DESCRIPTIONS.map((product) => ({ ...product, ...DEFAULT_PRICING[product.id], ...(pricing[product.id] || {}) }))

export const LOAN_PRODUCTS = buildProducts()

export const getProduct = (id, products = LOAN_PRODUCTS) => products.find((product) => product.id === id)

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
