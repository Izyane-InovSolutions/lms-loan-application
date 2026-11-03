/**
 * Legal review: what a legal officer (legal.verify) checks on a case — each pledged
 * collateral item and each document the applicant and staff sent — and whether it is done.
 * Shared by the server, which holds approval until it is (Settings → Credit workflow,
 * requireLegalReview), and the case page, which shows what is left.
 *
 * Checks live in applications.verifications: { collateral: { [index]: check },
 * documents: { [documentId]: check } }, each { status: 'verified' | 'issue', note, by, byName, at }.
 */

import { collateralItems, itemLabel } from './collateral.js'
import { supersededDocuments } from './applications.js'

/** The documents to check: uploaded ones (not generated), current copies only. */
export const reviewableDocuments = (documents) => {
  const replaced = supersededDocuments(documents)
  return documents.filter((document) => document.source !== 'system' && !replaced[document.id] && !document.supersededBy)
}

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
