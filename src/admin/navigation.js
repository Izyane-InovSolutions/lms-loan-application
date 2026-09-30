import { Activity, Columns3, FileStack, History, KeyRound, LayoutDashboard, Scale, Settings, ShieldCheck, Users } from 'lucide-react'
import { hasPermission, isStaffRole } from '@/config/roles'

const allowedTo = (permission) => (user) => hasPermission(user, permission)

/**
 * Sidebar sections. An item is shown when `allow(user)` is true; the server enforces
 * the same permissions on every request, so hiding an item is convenience, not security.
 */
export const NAV_SECTIONS = [
  {
    label: 'Work',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, allow: (user) => isStaffRole(user.role) },
      { to: '/admin/applications', label: 'Applications', icon: FileStack, allow: (user) => isStaffRole(user.role) },
      { to: '/admin/pipeline', label: 'Pipeline', icon: Columns3, allow: allowedTo('pipeline.view') },
    ],
  },
  {
    label: 'Policy',
    items: [{ to: '/admin/rules', label: 'Policy rules', icon: Scale, allow: (user) => hasPermission(user, 'rules.view') || hasPermission(user, 'rules.manage') }],
  },
  {
    label: 'People',
    items: [
      { to: '/admin/users', label: 'Team', icon: Users, allow: allowedTo('users.view') },
      { to: '/admin/roles', label: 'Roles', icon: KeyRound, allow: allowedTo('roles.manage') },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/admin/audit', label: 'Audit log', icon: History, allow: allowedTo('audit.view') },
      { to: '/admin/data-requests', label: 'Data requests', icon: ShieldCheck, allow: allowedTo('privacy.manage') },
      { to: '/admin/health', label: 'System health', icon: Activity, allow: allowedTo('system.health') },
      { to: '/admin/settings', label: 'Settings', icon: Settings, allow: allowedTo('settings.manage') },
    ],
  },
]

export const navFor = (user) =>
  NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => item.allow(user)) })).filter(
    (section) => section.items.length
  )
