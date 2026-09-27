/**
 * Roles and what each may do. Shared by the API (which enforces it) and the admin UI
 * (which only uses it to decide what to show) — the server is the only real gate.
 *
 * Row-level visibility of applications (DSA: own, RM: own + team, …) is not expressed
 * here; it lives with the queries in api/_lib/rbac.js.
 */

export const ROLES = {
  admin: {
    label: 'Administrator',
    description: 'Manages users, credit rules and settings. Sees everything.',
  },
  loan_officer: {
    label: 'Loan officer',
    description: 'Appraises applications and makes credit decisions.',
  },
  sales_manager: {
    label: 'Sales manager',
    description: 'Oversees the sales team, its pipeline and performance.',
  },
  rm: {
    label: 'Relationship manager',
    description: 'Manages a portfolio of customers and the agents assigned to them.',
  },
  dsa: {
    label: 'Direct sales agent',
    description: 'Refers customers and fills in applications on their behalf.',
  },
  customer: {
    label: 'Customer',
    description: 'Applies for loans and follows their applications.',
  },
}

export const STAFF_ROLES = ['admin', 'loan_officer', 'sales_manager', 'rm', 'dsa']

export const isStaffRole = (role) => STAFF_ROLES.includes(role)

export const roleLabel = (role) => ROLES[role]?.label || role

const PERMISSIONS = {
  // Invite, edit, disable staff accounts.
  'users.manage': ['admin'],
  // See the staff directory (RMs and sales managers need it to follow their team).
  'users.view': ['admin', 'sales_manager', 'rm'],
  'audit.view': ['admin'],
  'settings.manage': ['admin'],
}

export const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role)

export const USER_STATUSES = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
}
