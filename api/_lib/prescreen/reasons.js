/*
 * Why a fact the credit rules need is unknown, in words an officer can act on — shown on
 * the case instead of "not known". Worked out alongside the facts (facts.js) from the same
 * inputs: the form, the documents and what the AI read from them, the location and the
 * credit bureau report.
 *
 * Each reason says what is missing and, where there is one, what to do about it.
 */

import { isSalaried } from '../../../src/config/applicantRules.js'

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

// "a invoice" → "an invoice".
const withArticle = (noun) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`

/*
 * A reason is { why, fix, action }: what went wrong, what to do about it, and which
 * button the case page offers for it (enter_figure, ask_applicant, run_crb, settings,
 * rerun, or null). reasonText() joins why and fix into the sentence stored before parts existed.
 */
const reason = (why, fix = '', action = null) => ({ why, fix, action })
export const reasonText = ({ why, fix }) => (fix ? `${why} ${fix}` : why)

const ENTER_FIX = (spec) => `Enter the ${spec.figure} under “Figures from documents”.`

/** Why a figure read from a document is missing. */
const documentReason = (spec, documents, { aiOn, submittedAt, application }) => {
  const uploads = documents.filter((document) => document.docType === spec.docType)
  if (!uploads.length && spec.docType === 'payslips' && !isSalaried(application.data))
    return reason(`The applicant isn’t paid a salary (${application.data?.employmentInfo?.occupation?.toLowerCase() || 'not employed'}), so there are no payslips.`, `Use the bank statements, or ${lowerFirst(ENTER_FIX(spec))}`, 'enter_figure')
  if (!uploads.length) return reason(spec.optional ? `No ${spec.document} was uploaded (it’s optional).` : `No ${spec.document} was uploaded.`, `Ask the applicant for one, or ${lowerFirst(ENTER_FIX(spec))}`, 'ask_applicant')
  const read = uploads.find((document) => document.aiAnalysis)
  if (!read) {
    if (!aiOn) return reason(`The ${spec.document} wasn’t read: AI document checks are switched off or no AI model is connected (Settings → AI document checks).`, ENTER_FIX(spec), 'enter_figure')
    // Added on the case after submission (by staff, or in reply to a request): not read.
    const after = (document) => submittedAt && new Date(document.createdAt).getTime() - new Date(submittedAt).getTime() > 60 * 1000
    if (uploads.every(after)) return reason(`The ${spec.document} was added after submission and couldn’t be read automatically.`, ENTER_FIX(spec), 'enter_figure')
    return reason(`The AI didn’t finish reading the ${spec.document} before the application was submitted, or couldn’t reach the AI service.`, ENTER_FIX(spec), 'enter_figure')
  }
  const analysis = read.aiAnalysis
  if (analysis.matchesExpectedType === false)
    return reason(`The file uploaded as the ${spec.document} doesn’t look like one${analysis.detectedType ? ` (it looks like ${withArticle(analysis.detectedType)})` : ''}.`, `Ask the applicant for the right document, or ${lowerFirst(ENTER_FIX(spec))}`, 'ask_applicant')
  if (analysis.legibility === 'illegible') return reason(`The ${spec.document} is too hard to read for the ${spec.figure} to be found.`, `Ask for a clearer copy, or ${lowerFirst(ENTER_FIX(spec))}`, 'ask_applicant')
  return reason(`The AI read the ${spec.document} but couldn’t find the ${spec.figure} on it.`, ENTER_FIX(spec), 'enter_figure')
}

/**
 * Why each unknown fact is unknown, in parts (see reason above).
 * @param application  applications row (with `data`)
 * @param documents    its application_documents rows
 * @param facts        the facts computed from them (facts.js)
 * @param context      { aiOn, distance: { km, why, fix, action, reason }, crbProvider }
 * @returns { [fact]: { why, fix, action } } for the facts that are unknown
 */
export const factReasonDetails = (application, documents, facts, context = {}) => {
  const reasons = {}
  const unknown = (fact) => facts[fact] === null || facts[fact] === undefined || Number.isNaN(facts[fact])

  for (const [fact, spec] of Object.entries(FROM_DOCUMENT)) {
    if (unknown(fact)) reasons[fact] = documentReason(spec, documents, { ...context, submittedAt: application.submittedAt, application })
  }
  // A ratio is unknown because the figure under it is: the same why and fix, said of the ratio.
  for (const [fact, spec] of Object.entries(RATIOS)) {
    if (!unknown(fact)) continue
    const under = reasons[spec.needs]
    reasons[fact] = under ? reason(`${spec.what}: ${lowerFirst(under.why)}`, under.fix, under.action) : reason(`${spec.what}.`)
  }

  const birthField = application.loanType === 'personal' ? 'the applicant' : 'the applying director'
  const ask = 'Ask the applicant to correct it.'
  if (unknown('applicant_age')) reasons.applicant_age = reason(`There’s no valid date of birth for ${birthField} on the application.`, ask, 'ask_applicant')
  if (unknown('age_at_maturity')) reasons.age_at_maturity = reason(`There’s no valid date of birth for ${birthField}, so their age when the loan ends can’t be worked out.`, ask, 'ask_applicant')
  if (unknown('business_age_months')) reasons.business_age_months = reason('There’s no valid date the business was established on the application.', ask, 'ask_applicant')
  if (unknown('directors_count')) reasons.directors_count = reason('No directors are listed on the application.', ask, 'ask_applicant')
  const distance = context.distance || {}
  const located = distance.why ? reason(distance.why, distance.fix, distance.action) : null
  if (unknown('location_distance_km')) reasons.location_distance_km = located || reason(distance.reason || 'The distance couldn’t be worked out.')
  if (unknown('address_found')) reasons.address_found = located || reason(distance.reason || 'The home address wasn’t looked up on the map.')
  if (unknown('crb_score'))
    reasons.crb_score = context.crbProvider ? reason('No credit bureau report has been pulled yet.', 'Run a credit check on this case.', 'run_crb') : reason('No credit bureau is connected, so there is no score.', 'Connect one under Settings → Credit bureau.', 'settings')
  if (unknown('collateral_value')) reasons.collateral_value = reason('The applicant didn’t pledge any collateral.')
  if (unknown('collateral_cover')) reasons.collateral_cover = reason('The applicant didn’t pledge any collateral, so there is nothing to compare with the loan.')
  if (unknown('collateral_lending_value')) reasons.collateral_lending_value = reason('The applicant didn’t pledge any collateral.')
  if (unknown('collateral_lending_cover')) reasons.collateral_lending_cover = reason('The applicant didn’t pledge any collateral, so there is nothing to compare with the loan.')
  return reasons
}

/** The same, as one sentence each: what the location panel and older screens show. */
export const factReasons = (application, documents, facts, context = {}) =>
  Object.fromEntries(Object.entries(factReasonDetails(application, documents, facts, context)).map(([fact, detail]) => [fact, reasonText(detail)]))

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
