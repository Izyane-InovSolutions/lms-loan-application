/**
 * Legal review: the legal officer's check (legal.verify) of the collateral — each pledged item
 * and every proof file attached to it: that it exists, is the applicant's, and is free of other
 * claims. Part of underwriting: a secured loan isn't approved until it is done (appraisal.js,
 * Settings → Credit workflow, requireLegalReview). A loan with no collateral has nothing here.
 * The other documents are underwriting's to check (the officer's checklist and the AI checks).
 *
 * Checks live in applications.verifications: { collateral: { [index]: check },
 * documents: { [documentId]: check } }, each { status: 'verified' | 'issue', note, by, byName, at }.
 */

import { collateralItems, itemLabel } from './collateral.js'
import { supersededDocuments } from './applications.js'

// A collateral item's proof file: collateral.0.1, or collateral.0 from before several were allowed.
const PROOF_SLOT = /^collateral\.(\d+)(?:\.\d+)?$/

/** The documents the legal officer checks: the collateral's proof files, current copies only. */
export const reviewableDocuments = (documents) => {
  const replaced = supersededDocuments(documents)
  return documents.filter((document) => PROOF_SLOT.test(document.slot) && document.source !== 'system' && !replaced[document.id] && !document.supersededBy)
}

/** The proof files of collateral item `index`. */
export const proofsOfItem = (documents, index) => reviewableDocuments(documents).filter((document) => Number(PROOF_SLOT.exec(document.slot)[1]) === index)

/**
 * What stands between the case and approval: { unchecked: [label], issues: [{ label, note }] },
 * both empty when every item and document is verified.
 */
export const legalReviewOutstanding = (application, documents, catalog) => {
  const checks = application?.verifications || {}
  const entries = [
    ...collateralItems(application?.data).map((item, index) => ({ label: `Collateral ${index + 1}: ${itemLabel(item, catalog)}`, check: checks.collateral?.[index] })),
    ...reviewableDocuments(documents).map((document) => ({ label: document.label, check: checks.documents?.[document.id] })),
  ]
  return {
    unchecked: entries.filter((entry) => !entry.check).map((entry) => entry.label),
    issues: entries.filter((entry) => entry.check?.status === 'issue').map((entry) => ({ label: entry.label, note: entry.check.note })),
  }
}

/** Whether the legal review is complete: nothing unchecked, no issue left open. */
export const legalReviewComplete = (outstanding) => !outstanding.unchecked.length && !outstanding.issues.length

/** One sentence on what is left, for refusals and the case page. */
export const describeOutstanding = ({ unchecked, issues }) => {
  const parts = []
  if (issues.length) parts.push(`${issues.length === 1 ? 'an issue is' : `${issues.length} issues are`} recorded (${issues.map((issue) => issue.label).join(', ')})`)
  if (unchecked.length) parts.push(`${unchecked.length === 1 ? '1 item isn’t' : `${unchecked.length} items aren’t`} verified yet (${unchecked.join(', ')})`)
  return parts.join(', and ')
}
