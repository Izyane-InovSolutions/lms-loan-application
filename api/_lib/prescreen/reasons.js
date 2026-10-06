/*
 * Why a fact the credit rules need is unknown, in words an officer can act on — shown on
 * the case instead of "not known". Worked out alongside the facts (facts.js) from the same
 * inputs: the form, the documents and what the AI read from them, the location and the
 * credit bureau report.
 *
 * Each reason says what is missing and, where there is one, what to do about it.
 */

const ENTER = 'Enter it under “Figures from documents” on this case.'

// Facts read from a document: which upload, which field, and how to name them.
const FROM_DOCUMENT = {
  net_monthly_pay: { docType: 'payslips', field: 'netPay', manual: 'netPay', document: 'payslip', figure: 'net (take-home) pay' },
  average_monthly_credits: { docType: 'bankStatements', field: 'averageMonthlyCredits', manual: 'averageMonthlyCredits', document: 'bank statement', figure: 'average monthly money paid in' },
  annual_turnover: { docType: 'latestTaxComplianceReturn', field: 'turnover', manual: 'annualTurnover', document: 'tax return', figure: 'turnover' },
  order_value: { docType: 'orderOrInvoice', field: 'amount', manual: 'orderValue', document: 'order or invoice', figure: 'order value', optional: true },
}

// Ratios, and the fact whose absence makes them unknown.
const RATIOS = {
  debt_to_income: { needs: 'net_monthly_pay', what: 'The instalment can’t be compared with take-home pay' },
  instalment_to_credits: { needs: 'average_monthly_credits', what: 'The instalment can’t be compared with money paid into the account' },
  loan_to_turnover: { needs: 'annual_turnover', what: 'The loan can’t be compared with turnover' },
  loan_to_order: { needs: 'order_value', what: 'The loan can’t be compared with the order it finances' },
}

/** Why a figure read from a document is missing. */
const documentReason = (spec, documents, { aiOn, submittedAt }) => {
  const uploads = documents.filter((document) => document.docType === spec.docType)
  if (!uploads.length) return spec.optional ? `No ${spec.document} was uploaded (it’s optional).` : `No ${spec.document} was uploaded.`
  const read = uploads.find((document) => document.aiAnalysis)
  if (!read) {
    if (!aiOn) return `The ${spec.document} wasn’t read: AI document checks are switched off or no AI model is connected (Settings → AI document checks). ${ENTER}`
    // Added on the case after submission (by staff, or in reply to a request): not read.
    const after = (document) => submittedAt && new Date(document.createdAt).getTime() - new Date(submittedAt).getTime() > 60 * 1000
    if (uploads.every(after)) return `The ${spec.document} was added after submission, so the AI didn’t read it. ${ENTER}`
    return `The AI didn’t finish reading the ${spec.document} before the application was submitted, or couldn’t reach the AI service. ${ENTER}`
  }
  const analysis = read.aiAnalysis
  if (analysis.matchesExpectedType === false) return `The file uploaded as the ${spec.document} doesn’t look like one${analysis.detectedType ? ` (it looks like a ${analysis.detectedType})` : ''}. Ask the applicant for the right document, or ${ENTER.charAt(0).toLowerCase()}${ENTER.slice(1)}`
  if (analysis.legibility === 'illegible') return `The ${spec.document} is too hard to read for the ${spec.figure} to be found. Ask for a clearer copy, or ${ENTER.charAt(0).toLowerCase()}${ENTER.slice(1)}`
  return `The AI read the ${spec.document} but couldn’t find the ${spec.figure} on it. ${ENTER}`
}

/**
 * @param application  applications row (with `data`)
 * @param documents    its application_documents rows
 * @param facts        the facts computed from them (facts.js)
 * @param context      { aiOn, distance: { km, reason }, crbProvider }
 * @returns { [fact]: reason } for the facts that are unknown
 */
export const factReasons = (application, documents, facts, context = {}) => {
  const reasons = {}
  const unknown = (fact) => facts[fact] === null || facts[fact] === undefined || Number.isNaN(facts[fact])

  for (const [fact, spec] of Object.entries(FROM_DOCUMENT)) {
    if (unknown(fact)) reasons[fact] = documentReason(spec, documents, { ...context, submittedAt: application.submittedAt })
  }
  for (const [fact, spec] of Object.entries(RATIOS)) {
    if (unknown(fact)) reasons[fact] = unknown(spec.needs) ? `${spec.what}: ${lowerFirst(reasons[spec.needs] || 'that figure is unknown.')}` : `${spec.what}.`
  }

  const birthField = application.loanType === 'personal' ? 'the applicant' : 'the applying director'
  if (unknown('applicant_age')) reasons.applicant_age = `There’s no valid date of birth for ${birthField} on the application.`
  if (unknown('age_at_maturity')) reasons.age_at_maturity = `There’s no valid date of birth for ${birthField}, so their age when the loan ends can’t be worked out.`
  if (unknown('business_age_months')) reasons.business_age_months = 'There’s no valid date the business was established on the application.'
  if (unknown('directors_count')) reasons.directors_count = 'No directors are listed on the application.'
  if (unknown('location_distance_km')) reasons.location_distance_km = context.distance?.reason || 'The distance couldn’t be worked out.'
  if (unknown('address_found')) reasons.address_found = context.distance?.reason || 'The home address wasn’t looked up on the map.'
  if (unknown('crb_score')) reasons.crb_score = context.crbProvider ? 'No credit bureau report has been pulled yet. Run a credit check on this case.' : 'No credit bureau is connected, so there is no score.'
  return reasons
}

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1)

/** Where each document figure came from: entered by an officer, or read by the AI. */
export const factSources = (application, facts) => {
  const figures = application.checks?.figures || {}
  const sources = {}
  for (const [fact, spec] of Object.entries(FROM_DOCUMENT)) {
    if (unknown(facts[fact])) continue
    const entry = figures[spec.manual]
    sources[fact] = entry ? `Entered by ${entry.byName}` : `Read by AI from the ${spec.document}`
  }
  for (const [fact, spec] of Object.entries(RATIOS)) if (!unknown(facts[fact]) && sources[spec.needs]) sources[fact] = sources[spec.needs]
  return sources
}

const unknown = (value) => value === null || value === undefined || Number.isNaN(value)

/** The figures an officer may enter by hand, by loan type: key → the fact it stands in for. */
export const MANUAL_FIGURES = {
  personal: { netPay: 'net_monthly_pay', averageMonthlyCredits: 'average_monthly_credits' },
  business: { averageMonthlyCredits: 'average_monthly_credits', annualTurnover: 'annual_turnover', orderValue: 'order_value' },
}
