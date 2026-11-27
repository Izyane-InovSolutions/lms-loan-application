/**
 * Underwriting: what the case is verified on before it goes for a decision, in up to three
 * sections. Shared by the server, which holds the case in a `work: 'underwriting'` state until
 * it is complete (api/_lib/workflow.js), and the case page, which shows what is left.
 *
 *   valuation   one per pledged asset (applications.valuations[index]): the valuer's report,
 *               market value and date. Settings → Credit workflow requireValuation.
 *   legal       one per pledged asset (applications.verifications.legal[index]): the title
 *               documents and the six legal checks, by the legal officer (legal.verify).
 *               Settings → Credit workflow requireLegalReview.
 *   documents   every loan: the current copy of each required document, verified
 *               (applications.verifications.documents[documentId]). A new copy starts unchecked.
 * A loan without assets has only the documents.
 */

import { requestableSlots, supersededDocuments } from './applications.js'
import { collateralItems, itemLabel } from './collateral.js'
import { proofsOfItem } from './legalReview.js'

export const LEGAL_CHECKS = [
  ['title_authenticity', 'Title authenticity'],
  ['ownership', 'Ownership verification'],
  ['encumbrance', 'Existing encumbrance check'],
  ['litigation', 'Litigation check'],
  ['regulatory', 'Regulatory check'],
  ['search_report', 'Search report verification'],
]

/** Who verified the title, as the legal record names them. */
export const LEGAL_ROLES = [
  ['advocate', 'Advocate'],
  ['conveyancer', 'Conveyancer'],
  ['legal_officer', 'Legal officer'],
  ['other', 'Other'],
]

/** The valuation methods a valuer may have used. */
export const VALUATION_METHODS = [
  ['market', 'Market comparison'],
  ['income', 'Income'],
  ['cost', 'Cost'],
  ['other', 'Other'],
]

/** The legal documents every asset starts with; "Add document" adds other_<n>. */
export const LEGAL_DOCUMENT_SLOTS = [
  ['title_deed', 'Title deed / ownership document', true],
  ['search_report', 'Search report', true],
  ['legal_opinion', 'Legal opinion', false],
]

/** A legal document slot key: a default one, or one added (other_1, other_2, …). */
export const LEGAL_SLOT_PATTERN = /^(?:title_deed|search_report|legal_opinion|other_\d{1,2})$/

/** An asset's legal documents: the default slots, then whatever the record holds (renamed, added, attached). */
export const legalDocumentsOf = (record) => ({
  ...Object.fromEntries(LEGAL_DOCUMENT_SLOTS.map(([key, label, required]) => [key, { label, required, documentId: null }])),
  ...(record?.documents || {}),
})

/** The slot key "Add document" uses next: other_1, other_2, … */
export const nextLegalSlot = (documents) => {
  let n = 1
  while (documents?.[`other_${n}`]) n += 1
  return `other_${n}`
}

// Documents that belong to a section of their own (collateral proofs, valuation reports, legal files).
const OWN_SECTION = /^(?:collateral|valuation|legal)\./

/**
 * The documents underwriting verifies: the current copy (not replaced, not generated) of each
 * of the product's required slots on the case.
 */
export const requiredDocumentsFor = (application, documents, product) => {
  const required = new Set(requestableSlots(product, application?.data).filter((entry) => entry.required && !OWN_SECTION.test(entry.slot)).map((entry) => entry.slot))
  const replaced = supersededDocuments(documents)
  return documents.filter((document) => required.has(document.slot) && document.source !== 'system' && !replaced[document.id] && !document.supersededBy)
}

const assetLabel = (item, index, catalog) => `Collateral ${index + 1}: ${itemLabel(item, catalog)}`

/*
 * Records made the older way, before underwriting (a regenerated workflow keeps its open cases):
 * a valuation with a market value and date but no method and no report (underwriting always
 * attaches the report first, so only the older appraisal leaves one without), and the
 * legal officer's per-item check (legalReview.js) — verified, and none of the item's proof files
 * with an open issue. Either is accepted as that asset's valuation or legal verification.
 */
const isEarlierValuation = (valuation) => Number(valuation?.marketValue) > 0 && Boolean(valuation?.valuedOn) && !valuation.method && !valuation.reportId

const isEarlierLegalCheck = (application, documents, index) =>
  application?.verifications?.collateral?.[index]?.status === 'verified' &&
  !proofsOfItem(documents || [], index).some((document) => application.verifications?.documents?.[document.id]?.status === 'issue')

const valuationOf = (application, item, index, catalog) => {
  const valuation = application?.valuations?.[index] || {}
  const earlier = isEarlierValuation(valuation)
  const missing = earlier
    ? []
    : [
        !valuation.reportId && 'the valuation report',
        !(Number(valuation.marketValue) > 0) && 'the market value',
        !valuation.valuedOn && 'the valuation date',
      ].filter(Boolean)
  return { index, label: assetLabel(item, index, catalog), complete: !missing.length, missing, ...(earlier ? { earlier: true } : {}) }
}

const legalOf = (application, item, index, catalog, documents) => {
  const record = application?.verifications?.legal?.[index] || {}
  const missing = [
    ...Object.values(legalDocumentsOf(record))
      .filter((document) => document.required && !document.documentId)
      .map((document) => document.label),
    ...LEGAL_CHECKS.filter(([key]) => !record.checks?.[key]?.done).map(([, label]) => label),
  ]
  const earlier = missing.length > 0 && isEarlierLegalCheck(application, documents, index)
  return { index, label: assetLabel(item, index, catalog), complete: earlier || !missing.length, missing: earlier ? [] : missing, ...(earlier ? { earlier: true } : {}) }
}

// What is left on the assets, section by section, as the workspace asks (requireValuation, requireLegalReview).
const assetHoldParts = ({ valuation, legal }, workflowSettings = {}, { only } = {}) => [
  ...(workflowSettings.requireValuation === false || only === 'legal' ? [] : valuation.filter((entry) => !entry.complete).map((entry) => `${entry.label} valuation (${entry.missing.join(', ')})`)),
  ...(workflowSettings.requireLegalReview === false || only === 'valuation' ? [] : legal.filter((entry) => !entry.complete).map((entry) => `${entry.label} legal verification (${entry.missing.join(', ')})`)),
]

/**
 * What holds an approval on a workflow version with an underwriting stage: each asset's valuation
 * and legal verification as underwriting records them (not the older per-item legal check,
 * appraisal.js), or the older records a regenerated workflow's open cases carry. `only: 'valuation'`
 * for a recommendation to approve; `documents`, the case's files (an older check's proofs). Null when nothing does.
 */
export const assetHold = (application, catalog, workflowSettings = {}, { only, documents = [] } = {}) => {
  const items = collateralItems(application?.data)
  const sections = { valuation: items.map((item, index) => valuationOf(application, item, index, catalog)), legal: items.map((item, index) => legalOf(application, item, index, catalog, documents)) }
  return assetHoldParts(sections, workflowSettings, { only }).join('; ') || null
}

/**
 * Where underwriting stands: each section's entries, whether it is complete (the sections the
 * workspace asks for), and what holds it, in one phrase (null when nothing does).
 */
export const underwritingStatus = (application, documents, product, catalog, workflowSettings = {}) => {
  const items = collateralItems(application?.data)
  const valuation = items.map((item, index) => valuationOf(application, item, index, catalog))
  const legal = items.map((item, index) => legalOf(application, item, index, catalog, documents))
  const checks = application?.verifications?.documents || {}
  const verified = requiredDocumentsFor(application, documents || [], product).map((document) => ({
    id: document.id,
    label: document.label,
    status: ['verified', 'issue'].includes(checks[document.id]?.status) ? checks[document.id].status : 'unchecked',
  }))

  const parts = assetHoldParts({ valuation, legal }, workflowSettings)
  const unverified = verified.filter((document) => document.status !== 'verified')
  if (unverified.length) parts.push(`verification of ${unverified.map((document) => (document.status === 'issue' ? `${document.label} (issue found)` : document.label)).join(', ')}`)
  return { valuation, legal, documents: verified, complete: !parts.length, hold: parts.length ? parts.join('; ') : null }
}
