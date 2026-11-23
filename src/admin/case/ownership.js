import { OPEN_STATUSES } from '../../config/applications.js'

/*
 * Whose case it is decides what this person sees, while it is being worked (before the
 * decision): its owner is whoever took it at this stage (a stage for given roles) or its
 * officer. Not taken: only taking (or assigning) it. Someone else's: who has it, and
 * reassigning for those who may. The owner's own work (withdrawing, asking the applicant,
 * moving it on, recommending) is the owner's alone. A colleague's decision (four eyes)
 * stays open to others, and once the case is decided ownership no longer gates anything.
 */
export const caseOwnership = (application, workflow, userId) => {
  const roleStage = Boolean(workflow?.state?.roles?.length)
  const ownerId = roleStage ? application.stateAssignee : application.assignedOfficer
  const gated = OPEN_STATUSES.includes(application.status) && workflow?.phase === 'review'
  const mine = Boolean(ownerId) && ownerId === userId
  return {
    mine,
    free: !ownerId,
    gated,
    ownerMay: !gated || mine,
    ownerName: !roleStage && application.assignedOfficerName ? application.assignedOfficerName : 'a colleague',
  }
}
