/**
 * The processing flow after submission, as the workspace configures it (Settings →
 * Stages). Shared by the API, which enforces it, and the workspace, which shows it.
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

export const STAGE_PHASES = {
  review: {
    label: 'During review',
    description: 'Done in order while the case is in review. Nobody can recommend until they are all done.',
    defaultPermission: 'cases.work',
    blocks: 'recommend',
  },
  approval: {
    label: 'Before the decision',
    description: 'After the recommendation. Nobody can approve or decline until they are all done.',
    defaultPermission: 'cases.decide',
    blocks: 'decide',
  },
  closing: {
    label: 'Before payout',
    description: 'After the customer accepts. The loan isn’t sent to the LMS or marked paid out until they are all done.',
    defaultPermission: 'cases.disburse',
    blocks: 'payout',
  },
}

export const PHASE_KEYS = Object.keys(STAGE_PHASES)

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

export const checkLabel = (config, key) => checklistOf(config).find((check) => check.key === key)?.label || key

/** The stages of a phase that apply to this product, in order. */
export const stagesFor = (config, phase, loanType) =>
  (config?.[phase] || []).filter((stage) => !stage.products?.length || stage.products.includes(loanType))

/** Stages of a phase this case has not done yet, in order. */
export const pendingStages = (config, phase, application) =>
  stagesFor(config, phase, application.loanType).filter((stage) => !application.stageProgress?.[stage.id]?.done)

/** The stage this case is on within a phase, or null when the phase has none left. */
export const currentStage = (config, phase, application) => pendingStages(config, phase, application)[0] || null

/** Which phase's stages a case is working through right now, from its status. */
export const phaseForStatus = (status, { requireAcceptance = true } = {}) => {
  if (status === 'in_review') return 'review'
  if (status === 'pending_approval') return 'approval'
  if (status === 'accepted' || (status === 'approved' && !requireAcceptance)) return 'closing'
  return null
}

/** Finds a stage by id across every phase. */
export const findStage = (config, id) => {
  for (const phase of PHASE_KEYS) {
    const stage = (config?.[phase] || []).find((entry) => entry.id === id)
    if (stage) return { phase, stage }
  }
  return null
}
