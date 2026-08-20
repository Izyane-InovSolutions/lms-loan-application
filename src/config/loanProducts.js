/**
 * Single source of truth for loan product facts.
 *
 * Every number here is mirrored from the application wizard so the marketing copy
 * can never drift from what an applicant actually sees:
 *   amounts / interest / facility fee  -> DashboardPage.tailwind.jsx
 *   step titles                        -> personalStepTitles / businessStepTitles
 *   document lists                     -> utils/loanPayloadMapper.js
 * When the wizard moves into its own module during the refactor, it should import
 * these constants rather than redeclaring them.
 */

export const INTEREST_RATE = 0.05
export const FACILITY_FEE = 175
export const DEFAULT_TENURE_MONTHS = 6

export const DRAFT_RETENTION_DAYS = 7
export const OTP_EXPIRY_MINUTES = 10

export const formatKwacha = (value) => `K${Number(value).toLocaleString()}`

/** Mirrors totalRepayable in the wizard: principal + flat interest + facility fee. */
export const totalRepayable = (amount) => amount + amount * INTEREST_RATE + FACILITY_FEE

export const monthlyInstalment = (amount, tenure) =>
  tenure > 0 ? totalRepayable(amount) / tenure : totalRepayable(amount)

export const LOAN_PRODUCTS = [
  {
    id: 'personal',
    name: 'Personal Loan',
    tagline: 'For salaried applicants',
    description:
      'Borrow against your salary for school fees, medical costs, home improvements or any personal need. Repay over a tenure you choose.',
    minAmount: 500,
    maxAmount: 100000,
    exampleAmount: 5000,
    steps: ['Personal information', 'Residence & Employment', 'Documents', 'Loan Terms', 'Overview'],
    documents: ['Salary Slip', 'Bank Statement', 'NRC Copy', 'Passport Photo', 'TPIN Certificate'],
  },
  {
    id: 'business',
    name: 'Business Loan',
    tagline: 'For registered companies',
    description:
      'Working capital for registered Zambian businesses — fund an order, bridge a payment gap, or invest in equipment and stock.',
    minAmount: 5000,
    maxAmount: 500000,
    exampleAmount: 25000,
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

export const getProduct = (id) => LOAN_PRODUCTS.find((product) => product.id === id)

/** The four stages an applicant moves through, independent of loan type. */
export const APPLICATION_JOURNEY = [
  {
    title: 'Tell us about you',
    description:
      'Personal and employment details, or your company and director information. Every field is validated as you type, so nothing bounces back later.',
  },
  {
    title: 'Verify it is you',
    description:
      'A short liveness check using your device camera — turn your head, smile, blink. It runs entirely on your device; no video ever leaves it.',
  },
  {
    title: 'Upload your documents',
    description:
      'Attach your supporting documents straight from your phone or laptop. Files are stored securely and stay attached to your draft.',
  },
  {
    title: 'Choose terms and submit',
    description:
      'Pick your amount and tenure, review the full repayment breakdown, accept the terms, and submit. You get an on-screen confirmation.',
  },
]
