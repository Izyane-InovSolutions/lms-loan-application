import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { getLoanApplications, extractErrorMessage } from '../services/lmsApi'

function ApplicationsPage() {
  const [applications, setApplications] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getLoanApplications()
      .then((data) => {
        if (!cancelled) setApplications(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const columns = applications && applications.length > 0 ? Object.keys(applications[0]) : []

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Header />
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-6">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">My Applications</h1>
              <p className="mt-2 text-sm text-slate-600">Loan applications submitted from this browser session.</p>
            </div>
            <Link
              to="/"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
            >
              Back to home
            </Link>
          </div>

          {loading && <p className="text-sm text-slate-600">Loading applications...</p>}

          {!loading && error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {!loading && !error && applications && applications.length === 0 && (
            <p className="text-sm text-slate-600">No applications found.</p>
          )}

          {!loading && !error && applications && applications.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    {columns.map((column) => (
                      <th key={column} className="px-3 py-2 font-semibold">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application, index) => (
                    <tr key={application.name || index} className="border-b border-slate-100">
                      {columns.map((column) => (
                        <td key={column} className="px-3 py-2 text-slate-700">
                          {typeof application[column] === 'object'
                            ? JSON.stringify(application[column])
                            : String(application[column] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default ApplicationsPage
