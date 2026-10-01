/**
 * The older stages settings (Settings → Stages, now retired from the workspace). Until a
 * workflow is saved in the Workflow editor, these still describe it: legacyToWorkflow
 * (src/config/workflow.js) turns them into the workflow cases follow.
 *
 * The backbone — submitted, in review, awaiting approval, approved, accepted, paid out —
 * stays fixed, because decisions, offers and the LMS hang off it. Around it, admins add
 * their own stages in three places:
 *
 *   review     while a case is in review, before anyone can recommend
 *   approval   after the recommendation, before the decision (a credit committee, say)
 *   closing    after the customer accepts, before payout and the LMS hand-off
 *
 * Each stage is done in order. It can require checklist items, be limited to some roles
 * and products, and (approval stages) need someone other than the recommender.
 * A case records what it has done in `applications.stage_progress`.
 */

export const PHASE_KEYS = ['review', 'approval', 'closing']

/** The verification checklist every workspace starts with. */
export const DEFAULT_CHECKLIST = [
  { key: 'identity', label: 'Identity verified', hint: 'NRC matches the applicant and the photo.', requiredToApprove: true },
  { key: 'documents', label: 'Documents reviewed', hint: 'Every document is present, genuine and current.', requiredToApprove: true },
  { key: 'income', label: 'Income or cash flow verified', hint: 'Payslips or bank statements support the repayment.', requiredToApprove: true },
  { key: 'crb', label: 'Credit bureau reviewed', hint: 'No adverse listings, or they are explained.', requiredToApprove: false },
  { key: 'site_visit', label: 'Site visit', hint: 'Business premises or residence visited.', requiredToApprove: false },
]

/** The staff-facing names of the backbone statuses that can be renamed. */
export const RENAMABLE_STATUSES = ['submitted', 'in_review', 'info_requested', 'pending_approval', 'approved', 'accepted', 'disbursed', 'declined', 'withdrawn', 'expired']

export const DEFAULT_STAGES_CONFIG = {
  labels: {},
  checklist: DEFAULT_CHECKLIST,
  review: [],
  approval: [],
  closing: [],
}

export const checklistOf = (config) => (Array.isArray(config?.checklist) ? config.checklist : DEFAULT_CHECKLIST)
