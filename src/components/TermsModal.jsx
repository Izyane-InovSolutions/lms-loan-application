import React, { useEffect, useState } from 'react'

function TermsModal({ open, onClose, onAccept }) {
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!open) {
      setAccepted(false)
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4">
      <div className="w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-600">Salary Advance Facility Agreement</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Terms and conditions</h2>
          </div>
          <button className="text-3xl text-slate-400" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
          <p>
            This facility is offered to you as a pre-qualified existing customer of Absa Bank Zambia Plc. By accepting, you authorize the Bank to recover the total repayable amount from your salary credited to your nominated account.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            <li>Loan amount, facility fee, tenure and monthly repayment are as disclosed.</li>
            <li>Repayment is collected via standing order on your salary date.</li>
            <li>Facility fee will be deducted together with the agreed advance amount.</li>
            <li>By accepting, you confirm that you understand and agree to the salary deduction authority.</li>
          </ul>

          <label className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              I have read and accept the Salary Advance Facility Agreement, including the facility fee and salary deduction authority.
            </span>
          </label>
        </div>

        <button
          className="mt-6 w-full rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          type="button"
          disabled={!accepted}
          onClick={() => {
            onAccept()
          }}
        >
          Accept & continue
        </button>
      </div>
    </div>
  )
}

export default TermsModal
