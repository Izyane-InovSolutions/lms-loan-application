import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'

// Everything but the landing page loads on demand, so a first visit on a phone downloads
// only what it shows. The wizard (date pickers, camera face checks) and the staff
// workspace (charts, maps) are the heavy parts.
const DashboardPage = lazy(() => import('./pages/DashboardPage.tailwind.jsx'))
const MyApplicationsPage = lazy(() => import('./pages/MyApplicationsPage'))
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'))

function PageLoading() {
  return <div className="min-h-screen bg-background" aria-busy="true" />
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        {/* Each wizard step is addressable: /apply/:type/:step. The barer forms are
            kept so existing links still resolve; DashboardPage redirects them to the
            canonical URL. */}
        <Route path="/apply" element={<Suspense fallback={<PageLoading />}><DashboardPage /></Suspense>} />
        <Route path="/apply/:type" element={<Suspense fallback={<PageLoading />}><DashboardPage /></Suspense>} />
        <Route path="/apply/:type/:step" element={<Suspense fallback={<PageLoading />}><DashboardPage /></Suspense>} />
        <Route path="/my-applications" element={<Suspense fallback={<PageLoading />}><MyApplicationsPage /></Suspense>} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="/dashboard" element={<Navigate to="/apply" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
