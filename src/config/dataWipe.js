/**
 * Settings → Danger zone → Wipe data: what an administrator can permanently delete, in
 * the order it is wiped. Configuration (settings, staff, roles, credit rules, workflow,
 * templates, terms) is never in this list, so a wiped workspace still runs as set up.
 * Shared by the screen and the server (api/_handlers/dataWipe.js).
 */
export const WIPE_CATEGORIES = [
  {
    key: 'applications',
    label: 'Applications',
    description: 'Every submitted application with its uploaded and generated files, timeline, assessments, consents, locations, credit bureau reports and signatures.',
  },
  {
    key: 'drafts',
    label: 'Unfinished applications',
    description: 'Applications started but not submitted, and the files attached to them. Applicants lose their saved progress.',
  },
  {
    key: 'customers',
    label: 'Customer accounts',
    description: 'Applicants’ sign-in accounts. Staff accounts are never touched.',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Every staff member’s notification inbox.',
  },
  {
    key: 'dataRequests',
    label: 'Data protection requests',
    description: 'The ledger of access, correction and erasure requests.',
  },
  {
    key: 'errorReports',
    label: 'Error log',
    description: 'Errors recorded for System health.',
  },
  {
    key: 'auditLog',
    label: 'Audit log',
    description: 'Who did what, and when. An entry recording this wipe is always kept.',
  },
]

export const WIPE_KEYS = WIPE_CATEGORIES.map((category) => category.key)

/** What the administrator types to confirm. */
export const WIPE_PHRASE = 'WIPE'
