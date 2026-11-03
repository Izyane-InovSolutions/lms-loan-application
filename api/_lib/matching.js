import kv from './kv.js'
import { computeFacts, expectedFor } from './prescreen/facts.js'
import { findFormMismatches } from '../../src/utils/documentChecks.js'
import { getPublishedRuleset, rulesetEligibilityRules } from './prescreen/rulesets.js'
import { getProducts } from './products.js'
import { getSetting } from './settings.js'
import { DOCUMENT_CATALOGUE, buildLoanTypes, liveProducts } from '../../src/config/loanProducts.js'
import { INCOME_FACTS, checkRules, incomeFor, matchProducts, onlyDocumentIssues, withIncome } from '../../src/config/productEligibility.js'
import { affordabilityError } from '../../src/config/eligibility.js'

/*
 * Matching an applicant to loan products from their documents (src/config/productEligibility.js):
 * before submission, from the draft — the server's own analyses of what they uploaded, never
 * figures from the browser — and again on submission, from the filed documents.
 */

// The slots the facts read: every document either form knows how to check.
const CATALOGUE_SLOTS = {
  personal: [...DOCUMENT_CATALOGUE.personal.map((entry) => entry.slot), 'passportCopy'],
  business: DOCUMENT_CATALOGUE.business.map((entry) => entry.slot),
}

/** The analyses the server made of a draft's uploads (api/ai/analyze-document), as document rows the facts can read. */
export const draftDocuments = async (email, form) => {
  const rows = await Promise.all(
    CATALOGUE_SLOTS[form].map(async (slot) => {
      const kept = await kv.get(`aiAnalysis:${email}:${slot}`)
      return kept?.analysis ? { slot, docType: kept.docType || kept.analysis.docType || slot, aiAnalysis: kept.analysis } : null
    })
  )
  return rows.filter(Boolean)
}

const SLOT_LABELS = {
  personal: { ...Object.fromEntries(DOCUMENT_CATALOGUE.personal.map((entry) => [entry.slot, entry.label])), passportCopy: 'Passport copy' },
  business: Object.fromEntries(DOCUMENT_CATALOGUE.business.map((entry) => [entry.slot, entry.label])),
}

/**
 * What is wrong with each uploaded document that an applicant can put right by uploading
 * another copy: someone else's name or NRC on it (what identity_mismatches counts), named so
 * they know which to replace. Signs a document was altered are never shown to applicants:
 * those stay with staff (api/_lib/ai/documents.js).
 */
export const documentProblems = (form, data, documents) =>
  documents
    .map((document) => ({
      slot: document.slot,
      label: SLOT_LABELS[form][document.slot] || document.slot,
      problems: findFormMismatches(document.aiAnalysis, expectedFor(form, data, document.slot)),
    }))
    .filter((entry) => entry.problems.length)

/** The facts the eligibility rules test, before an amount is chosen: from the form's answers and the documents. */
export const eligibilityFacts = (form, data, documents) => computeFacts({ loanType: form, data, checks: {}, amount: null, tenure: null, monthlyInstalment: null }, documents)

/**
 * "We'll match you": every product on offer in a loan type, matched to the draft.
 * `stated` is { income, commitments }: commitments always come from the applicant; income
 * only counts when the documents couldn't give one.
 */
export const matchDraft = async (email, loanTypeKey, data, stated = {}) => {
  const loanType = buildLoanTypes(await getSetting('loanTypes')).find((type) => type.key === loanTypeKey)
  if (!loanType) return null
  const products = liveProducts(await getProducts()).filter((product) => product.enabled && product.loanType === loanType.key)
  const documents = email ? await draftDocuments(email, loanType.form) : []
  const facts = eligibilityFacts(loanType.form, data, documents)
  const rules = rulesetEligibilityRules(await getPublishedRuleset())
  return {
    ...matchProducts(products, rules, facts, { form: loanType.form, statedIncome: stated.income, commitments: Number(stated.commitments) || 0 }),
    documentProblems: documentProblems(loanType.form, data, documents),
  }
}

/**
 * On submission, for the product applied for: { route, incomeSource, documentIncome, failed,
 * unchecked, documentIssuesAccepted, error }. A matched application ("match") must meet the
 * rules — or fail only document ones the applicant chose to continue past (`acceptDocumentIssues`)
 * — and afford the terms on its document income (stated only when the documents gave none):
 * `error` says why not. One from the website finder qualified on stated figures already: its
 * rule results are kept for the officer, never blocking.
 */
export const checkSubmission = async (product, { route, data, documents, stated, amount, tenure, acceptDocumentIssues = false }) => {
  const facts = eligibilityFacts(product.form, data, documents)
  const rules = rulesetEligibilityRules(await getPublishedRuleset())
  const income = incomeFor(product.form, facts, stated.income)
  const documentIncome = product.form === 'personal' ? facts.net_monthly_pay : facts.average_monthly_credits
  let error = null
  // A matched application is judged on the income it was matched on (the documents', else
  // stated). One from the finder qualified on what was stated: the income rules (the net pay
  // bands) decide on that, and every rule's verdict on the documents is kept for the officer.
  const { failed, unchecked } = checkRules(product, rules, route === 'match' ? withIncome(product.form, facts, income.income) : facts)
  if (route !== 'match') {
    const incomeRules = rules.filter((rule) => rule.fact === INCOME_FACTS[product.form])
    const onStated = checkRules(product, incomeRules, withIncome(product.form, {}, Number(stated.income) || null))
    if (onStated.failed.length) error = onStated.failed[0].message
  }
  const documentIssuesAccepted = route === 'match' && acceptDocumentIssues && onlyDocumentIssues(failed)
  if (route === 'match') {
    if (failed.length && !documentIssuesAccepted) error = failed.find((entry) => !entry.document)?.message || failed[0].message
    else error = affordabilityError(product, { income: income.income, commitments: stated.commitments }, amount, tenure)
  }
  return {
    route,
    incomeSource: route === 'match' ? income.source : 'stated',
    documentIncome: documentIncome ?? null,
    income: route === 'match' ? income.income : Number(stated.income) || null,
    failed,
    unchecked: unchecked.map((entry) => entry.requirement),
    documentIssuesAccepted,
    error,
  }
}
