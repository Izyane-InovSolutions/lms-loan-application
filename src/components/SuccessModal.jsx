import React from 'react'

function SuccessModal({ open, onClose, loanType, amount, tenure, monthlyRepayment, totalRepayable }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4">
      <div className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl font-semibold text-emerald-600">✓</div>
          <h2 className="mt-4 text-2xl font-semibold text-slate-900">Application submitted</h2>
          <p className="mt-2 text-sm text-slate-600">Your {loanType} loan request has been received successfully.</p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between py-2">
            <span>Loan type</span>
            <strong>{loanType === 'personal' ? 'Personal Loan' : 'Business Loan'}</strong>
          </div>
          <div className="flex items-center justify-between py-2">
            <span>Loan amount</span>
            <strong>K{amount.toLocaleString()}</strong>
          </div>
          <div className="flex items-center justify-between py-2">
            <span>Tenure</span>
            <strong>{tenure} months</strong>
          </div>
          <div className="flex items-center justify-between py-2">
            <span>Estimated monthly repayment</span>
            <strong>K{monthlyRepayment.toFixed(2)}</strong>
          </div>
          <div className="flex items-center justify-between py-2">
            <span>Total repayable</span>
            <strong>K{totalRepayable.toFixed(2)}</strong>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button className="rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-700" type="button" onClick={onClose}>
            Back to home
          </button>
        </div>
      </div>
    </div>
  )
}

export default SuccessModal
