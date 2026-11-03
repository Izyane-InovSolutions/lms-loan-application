/**
 * What holds a case back at each step, from its collateral: shared by the server, which holds
 * the case (api/_lib/workflow.js), and the case page, which says what is left.
 *
 *   valuation   every pledged item valued (applications.valuations), when Settings → Credit
 *               workflow has requireValuation on. It holds leaving the Appraisal stage, and a
 *               recommendation to approve or an approval.
 *   legal       every pledged item and its proof files verified by the legal officer
 *               (legalReview.js), when requireLegalReview is on. It holds approval only: the
 *               legal check is part of underwriting.
 * A loan with no collateral has neither to wait for.
 */

import { collateralItems, itemLabel } from './collateral.js'
import { describeOutstanding, legalReviewComplete, legalReviewOutstanding } from './legalReview.js'

/** The pledged items not yet valued, by label ("Collateral 1: Passenger vehicle"). */
export const unvaluedItems = (application, catalog) =>
  collateralItems(application?.data)
    .map((item, index) => ({ label: `Collateral ${index + 1}: ${itemLabel(item, catalog)}`, valued: Number(application?.valuations?.[index]?.marketValue) > 0 }))
    .filter((entry) => !entry.valued)
    .map((entry) => entry.label)

/** "a valuation of Collateral 1: Passenger vehicle", or null when every item is valued (or the workspace doesn't ask). */
export const valuationHold = (application, catalog, workflowSettings = {}) => {
  if (workflowSettings.requireValuation === false) return null
  const unvalued = unvaluedItems(application, catalog)
  return unvalued.length ? `${unvalued.length === 1 ? 'a valuation of' : 'valuations of'} ${unvalued.join(', ')}` : null
}

/** "legal sign-off: …", or null when the collateral is verified (or the workspace doesn't ask). */
export const legalHold = (application, documents, catalog, workflowSettings = {}) => {
  if (workflowSettings.requireLegalReview === false) return null
  const outstanding = legalReviewOutstanding(application, documents, catalog)
  return legalReviewComplete(outstanding) ? null : `legal sign-off: ${describeOutstanding(outstanding)}`
}

/** What holds an approval, in one phrase; null when nothing does. */
export const approvalHold = (application, documents, catalog, workflowSettings = {}) =>
  [valuationHold(application, catalog, workflowSettings), legalHold(application, documents, catalog, workflowSettings)].filter(Boolean).join('; and ') || null
