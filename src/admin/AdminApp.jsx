import React, { lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { hasPermission, isStaffRole } from '@/config/roles'
import { AuthProvider, useAuth } from './auth'
import { ToastProvider } from './components'
import { Shell } from './Shell'
import { ForgotPasswordPage, LoginPage, SetPasswordPage } from './pages/AuthPages'

// Each page is its own chunk: charts, maps and the QR library load only where used.
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })))
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage').then((module) => ({ default: module.ApplicationsPage })))
const PipelinePage = lazy(() => import('./pages/PipelinePage').then((module) => ({ default: module.PipelinePage })))
const RulesPage = lazy(() => import('./pages/RulesPage').then((module) => ({ default: module.RulesPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const CasePage = lazy(() => import('./case/CasePage').then((module) => ({ default: module.CasePage })))
const DataRequestsPage = lazy(() => import('./pages/DataRequestsPage').then((module) => ({ default: module.DataRequestsPage })))
const HealthPage = lazy(() => import('./pages/HealthPage').then((module) => ({ default: module.HealthPage })))
const RolesPage = lazy(() => import('./pages/RolesPage').then((module) => ({ default: module.RolesPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))

/**
 * The staff workspace at /admin. Loaded lazily from App.jsx, so applicants on the
 * public site never download it.
 */
export default function AdminApp() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="set-password" element={<SetPasswordPage />} />
          <Route element={<RequireStaff />}>
            <Route index element={<HomePage />} />
            <Route path="applications" element={<ApplicationsPage />} />
            <Route path="applications/:id" element={<CasePage />} />
            <Route path="pipeline" element={<RequirePermission permission="pipeline.view"><PipelinePage /></RequirePermission>} />
            <Route path="rules" element={<RequirePermission permission={['rules.view', 'rules.manage']}><RulesPage /></RequirePermission>} />
            <Route path="settings" element={<RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission>} />
            <Route path="users" element={<RequirePermission permission="users.view"><UsersPage /></RequirePermission>} />
            <Route path="roles" element={<RequirePermission permission="roles.manage"><RolesPage /></RequirePermission>} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="data-requests" element={<RequirePermission permission="privacy.manage"><DataRequestsPage /></RequirePermission>} />
            <Route path="health" element={<RequirePermission permission="system.health"><HealthPage /></RequirePermission>} />
            <Route path="audit" element={<RequirePermission permission="audit.view"><AuditPage /></RequirePermission>} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  )
}

function RequireStaff() {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'signed-in') return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />
  // A customer session (from the public site) is not a staff login.
  if (!isStaffRole(user.role)) return <Navigate to="/admin/login" replace />
  // A role that requires two-step sign-in: nothing but the profile until it is set up.
  if (user.twoFactorSetupRequired && location.pathname !== '/admin/profile') return <Navigate to="/admin/profile" replace />
  return <Shell />
}

/**
 * Sends people to their home page when their role cannot open a page (e.g. after a demo
 * role switch). `permission` may be a list: any one of them opens the page.
 */
function RequirePermission({ permission, children }) {
  const { user } = useAuth()
  if (![].concat(permission).some((key) => hasPermission(user, key))) return <Navigate to="/admin" replace />
  return children
}
