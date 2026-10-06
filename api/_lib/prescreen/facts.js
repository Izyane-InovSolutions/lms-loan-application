import { findFormMismatches } from '../../../src/utils/documentChecks.js'

/*
 * The numbers the credit rules test, computed here from the application and the server's
 * own document analyses — never taken from the browser. Unknown stays null, so a rule
 * over it is "not evaluated" rather than silently passing.
 */

const parseAmount = (value) => {
  const number = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(number) && number > 0 ? number : null
}

const ratio = (numerator, denominator) => (numerator && denominator ? Number((numerator / denominator).toFixed(3)) : null)

const wholeYearsSince = (isoDate, now = new Date()) => {
  const date = new Date(isoDate)
  if (!isoDate || Number.isNaN(date.getTime())) return null
  let years = now.getFullYear() - date.getFullYear()
  const beforeBirthday = now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
  if (beforeBirthday) years -= 1
  return years
}

const monthsSince = (isoDate, now = new Date()) => {
  const date = new Date(isoDate)
  if (!isoDate || Number.isNaN(date.getTime())) return null
  return Math.max(0, (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth()))
}

// Business documents from ZRA, which print the company's TPIN.
export const TPIN_SLOTS = ['taxClearance', 'latestTaxComplianceReturn']

/** What each document should agree with on the form — the same pairs the wizard checks live. */
export const expectedFor = (loanType, data, slot) => {
  if (loanType === 'personal') {
    const { firstName, middleName, surname, nrc } = data?.personalInfo || {}
    const applicant = { name: [firstName, middleName, surname].filter(Boolean).join(' '), nrc }
    if (slot === 'payslips' || slot === 'nrcCopy') return applicant
    if (slot === 'bankStatements' || slot === 'tpin') return { name: applicant.name }
    return {}
  }
  const director = /^director\.(\d+)\.nrc$/.exec(slot)
  if (director) {
    const person = data?.directorInfo?.directors?.[Number(director[1])] || {}
    return { name: person.name, nrc: person.nrc }
  }
  if (['orderOrInvoice', 'passportPhoto'].includes(slot) || slot.startsWith('director.')) return {}
  const company = { companyName: data?.businessInfo?.companyName, holderIsCompany: true }
  return TPIN_SLOTS.includes(slot) ? { ...company, tpin: data?.businessInfo?.tpin } : company
}

const extracted = (documents, docType, field) =>
  parseAmount(documents.find((document) => document.docType === docType)?.aiAnalysis?.extracted?.[field])

// Photos have nothing to extract and nothing for the model to get wrong worth counting.
const CHECKABLE = (document) => !['passportPhoto', 'directorPassportPhoto'].includes(document.docType)

/**
 * @param application  applications row (with `data`)
 * @param documents    its application_documents rows
 * @param extras       { locations: [...], crbScore, locationDistanceKm }
 */
export const computeFacts = (application, documents, extras = {}) => {
  const { loanType, data } = application
  const facts = {
    amount: application.amount,
    tenure: application.tenure,
    monthly_instalment: application.monthlyInstalment,
  }

  const birthDate = loanType === 'personal' ? data?.personalInfo?.birthDate : data?.directorInfo?.applicantBirthDate
  facts.applicant_age = wholeYearsSince(birthDate)

  facts.average_monthly_credits = extracted(documents, 'bankStatements', 'averageMonthlyCredits')
  facts.instalment_to_credits = ratio(application.monthlyInstalment, facts.average_monthly_credits)

  if (loanType === 'personal') {
    facts.age_at_maturity = facts.applicant_age === null ? null : Number((facts.applicant_age + application.tenure / 12).toFixed(1))
    facts.net_monthly_pay = extracted(documents, 'payslips', 'netPay')
    facts.debt_to_income = ratio(application.monthlyInstalment, facts.net_monthly_pay)
  } else {
    facts.business_age_months = monthsSince(data?.businessInfo?.establishedDate)
    facts.annual_turnover = extracted(documents, 'latestTaxComplianceReturn', 'turnover')
    facts.loan_to_turnover = ratio(application.amount, facts.annual_turnover)
    facts.order_value = extracted(documents, 'orderOrInvoice', 'amount')
    facts.loan_to_order = ratio(application.amount, facts.order_value)
    facts.directors_count = data?.directorInfo?.directors?.length ?? null
  }

  const analysed = documents.filter((document) => document.aiAnalysis)
  facts.documents_wrong_type = analysed.filter((document) => document.aiAnalysis.matchesExpectedType === false).length
  facts.documents_illegible = analysed.filter((document) => ['illegible', 'partly_legible'].includes(document.aiAnalysis.legibility)).length
  facts.documents_outdated = analysed.filter((document) =>
    (document.aiAnalysis.issues || []).some((issue) => issue.code === 'expired' || issue.code === 'outdated')
  ).length
  facts.documents_unchecked = documents.filter((document) => CHECKABLE(document) && !document.aiAnalysis).length
  facts.identity_mismatches = analysed.reduce(
    (count, document) => count + findFormMismatches(document.aiAnalysis, expectedFor(loanType, data, document.slot)).length,
    0
  )
  facts.authenticity_concerns = analysed.reduce((count, document) => count + (document.aiAnalysis.authenticityConcerns?.length || 0), 0)

  const locations = extras.locations || []
  facts.location_provided = locations.length > 0
  facts.location_distance_km = extras.locationDistanceKm ?? null
  facts.crb_score = extras.crbScore ?? null

  return facts
}
