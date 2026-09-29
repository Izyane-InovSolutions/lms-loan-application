import { Activity, Columns3, FileStack, History, LayoutDashboard, Scale, Settings, ShieldCheck, Users } from 'lucide-react'
import { can, isStaffRole } from '@/config/roles'

/**
 * Sidebar sections. An item is shown when `allow(role)` is true; the server enforces
 * the same rules on every request, so hiding an item is convenience, not security.
 */
export const NAV_SECTIONS = [
  {
    label: 'Work',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, allow: isStaffRole },
      { to: '/admin/applications', label: 'Applications', icon: FileStack, allow: isStaffRole },
      { to: '/admin/pipeline', label: 'Pipeline', icon: Columns3, allow: (role) => ['dsa', 'rm', 'sales_manager', 'admin'].includes(role) },
    ],
  },
  {
    label: 'Policy',
    items: [{ to: '/admin/rules', label: 'Policy rules', icon: Scale, allow: (role) => ['admin', 'loan_officer', 'sales_manager'].includes(role) }],
  },
  {
    label: 'People',
    items: [{ to: '/admin/users', label: 'Team', icon: Users, allow: (role) => can(role, 'users.view') }],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/admin/audit', label: 'Audit log', icon: History, allow: (role) => can(role, 'audit.view') },
      { to: '/admin/data-requests', label: 'Data requests', icon: ShieldCheck, allow: (role) => role === 'admin' },
      { to: '/admin/health', label: 'System health', icon: Activity, allow: (role) => role === 'admin' },
      { to: '/admin/settings', label: 'Settings', icon: Settings, allow: (role) => can(role, 'settings.manage') },
    ],
  },
]

export const navFor = (role) =>
  NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => item.allow(role)) })).filter(
    (section) => section.items.length
  )
