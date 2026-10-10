/**
 * Roles and permissions, shared by the API (which enforces them) and the admin UI (which
 * only uses them to decide what to show) — the server is the only real gate.
 *
 * A role is a label, a scope (which applications its members see) and a set of
 * permissions. The built-in roles below start with these defaults; administrators change
 * them and add their own under Team → Roles (the `roles` table, api/_lib/roles.js). The
 * signed-in person's resolved permissions come back from /auth/me as `user.permissions`.
 */

export const PERMISSION_GROUPS = [
  {
    label: 'Bringing business in',
    permissions: [
      {
        key: 'applications.assist',
        label: 'Fill in applications for customers',
        description: 'Start, save and submit applications with a customer, and share a referral link. The application is credited to them.',
      },
      {
        key: 'team.lead',
        label: 'Lead a team of agents',
        description: 'Can be chosen as an agent’s manager. With the “team” scope, sees the team’s applications.',
      },
    ],
  },
  {
    label: 'Working cases',
    permissions: [
      {
        key: 'drafts.view',
        label: 'See unfinished applications',
        description: 'Drafts in the pipeline, within their scope: ones staff started, and customers’ own once they agreed to be contacted. Continue them with a customer, or send a reminder.',
      },
      { key: 'applications.note', label: 'Add notes, documents and field visits' },
      {
        key: 'offers.record',
        label: 'Record acceptance or withdrawal for a customer',
        description: 'Acceptance needs the code emailed to the customer.',
      },
      {
        key: 'cases.work',
        label: 'Review cases',
        description: 'Take cases, work the checklist, ask the applicant for more, run credit checks and re-run the prescreen.',
      },
      { key: 'cases.assign', label: 'Assign cases to someone else' },
      { key: 'cases.recommend', label: 'Recommend approval or decline' },
      {
        key: 'cases.decide',
        label: 'Approve or decline',
        description: 'Within their own approval limit. With four-eyes on, never on a case they recommended or brought in.',
      },
      { key: 'cases.disburse', label: 'Send to the LMS and record payouts' },
    ],
  },
  {
    label: 'Oversight',
    permissions: [
      { key: 'pipeline.view', label: 'See the pipeline board' },
      { key: 'reports.team', label: 'See team performance on the dashboard' },
      { key: 'rules.view', label: 'Read the credit rules' },
      { key: 'users.view', label: 'See the team directory' },
    ],
  },
  {
    label: 'Administration',
    permissions: [
      { key: 'rules.manage', label: 'Edit and publish the credit rules' },
      { key: 'users.manage', label: 'Invite and manage staff' },
      { key: 'roles.manage', label: 'Change roles and permissions' },
      { key: 'settings.manage', label: 'Change settings' },
      { key: 'audit.view', label: 'Read the audit log' },
      { key: 'privacy.manage', label: 'Handle data requests' },
      { key: 'system.health', label: 'See system health and run maintenance' },
    ],
  },
]

export const PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key))

export const isPermission = (key) => PERMISSIONS.includes(key)

/**
 * What administrators never do: bring business in. They oversee the people who do, so no
 * application is ever credited to an administrator, and none leads a team of agents.
 */
export const ADMIN_EXCLUDED_PERMISSIONS = ['applications.assist', 'team.lead']

/** The administrator's fixed set: everything else. */
export const ADMIN_PERMISSIONS = PERMISSIONS.filter((key) => !ADMIN_EXCLUDED_PERMISSIONS.includes(key))

/** Which applications a role's members see. */
export const SCOPES = {
  all: { label: 'Every application' },
  team: { label: 'Their own and their team’s', description: 'Applications they brought in or were assigned, plus those of agents who report to them.' },
  own: { label: 'Only their own', description: 'Applications they brought in or were assigned.' },
}

const RM_PERMISSIONS = ['applications.assist', 'team.lead', 'drafts.view', 'applications.note', 'offers.record', 'pipeline.view', 'reports.team', 'users.view']
const OFFICER_PERMISSIONS = ['applications.note', 'offers.record', 'cases.work', 'cases.assign', 'cases.recommend', 'cases.decide', 'cases.disburse', 'rules.view']

/** The roles every workspace has. Their label, scope and permissions can be changed; admin's cannot. */
export const BUILT_IN_ROLES = {
  admin: {
    label: 'Administrator',
    description: 'Manages users, roles, policy rules and settings. Sees everything, but doesn’t bring business in.',
    scope: 'all',
    permissions: ADMIN_PERMISSIONS,
  },
  sales_manager: {
    label: 'Sales manager',
    description: 'Runs sales and credit day to day: everything a relationship manager and a loan officer can do, across all applications.',
    scope: 'all',
    permissions: [...new Set([...RM_PERMISSIONS, ...OFFICER_PERMISSIONS])],
  },
  loan_officer: {
    label: 'Loan officer',
    description: 'Appraises applications and makes credit decisions.',
    scope: 'all',
    permissions: OFFICER_PERMISSIONS,
  },
  rm: {
    label: 'Relationship manager',
    description: 'Manages a portfolio of customers and the agents assigned to them.',
    scope: 'team',
    permissions: RM_PERMISSIONS,
  },
  dsa: {
    label: 'Direct sales agent',
    description: 'Refers customers and fills in applications on their behalf.',
    scope: 'own',
    permissions: ['applications.assist', 'drafts.view', 'applications.note', 'offers.record', 'pipeline.view'],
  },
}

/** Only ever the fixed defaults; the live roles come from the API. */
export const ROLES = {
  ...BUILT_IN_ROLES,
  customer: {
    label: 'Customer',
    description: 'Applies for loans and follows their applications.',
  },
}

/** The built-in staff roles, in the order the demo switcher shows them. */
export const STAFF_ROLES = Object.keys(BUILT_IN_ROLES)

/** Any role except customer is staff: custom roles are staff roles too. */
export const isStaffRole = (role) => typeof role === 'string' && role.length > 0 && role !== 'customer'

// Labels of the workspace's roles, custom ones included, once the admin app has loaded
// them (registerRoles). Until then, and on the public site, the built-in labels apply.
let registered = {}

export const registerRoles = (roles) => {
  registered = Object.fromEntries((roles || []).map((role) => [role.key, role]))
}

export const registeredRoles = () => Object.values(registered)

export const roleLabel = (role) => registered[role]?.label || ROLES[role]?.label || role

export const roleDescription = (role) => registered[role]?.description ?? ROLES[role]?.description ?? ''

/** Whether a role (from the registered list) has a permission. For forms that pick a role. */
export const roleHas = (role, permission) => Boolean(registered[role]?.permissions?.includes(permission))

/** Whether the signed-in person (as /auth/me returns them) has a permission. */
export const hasPermission = (user, permission) => Boolean(user?.permissions?.includes(permission))

export const USER_STATUSES = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
  deleted: 'Deleted',
}
