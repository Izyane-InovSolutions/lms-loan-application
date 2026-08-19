import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage.tailwind.jsx'
import ApplicationsPage from './pages/ApplicationsPage'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        {/* Each wizard step is addressable: /apply/:type/:step. The barer forms are
            kept so existing links still resolve; DashboardPage redirects them to the
            canonical URL. */}
        <Route path="/apply" element={<DashboardPage />} />
        <Route path="/apply/:type" element={<DashboardPage />} />
        <Route path="/apply/:type/:step" element={<DashboardPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/dashboard" element={<Navigate to="/apply" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
