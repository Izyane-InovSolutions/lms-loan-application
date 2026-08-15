import React from 'react'
import { AlertTriangle } from 'lucide-react'

import { focusField } from '@/lib/fieldId'

/**
 * Lists the current step's validation failures and jumps to the offending field.
 *
 * Without this, submitting an invalid step only repainted inline errors that were
 * often scrolled out of view, so the Continue button looked inert.
 */
export const ErrorSummary = React.forwardRef(({ errors }, ref) => {
  const entries = Object.entries(errors || {})
  if (entries.length === 0) return null

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="error-summary-title"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="error-summary-title" className="text-sm font-semibold text-destructive">
            {entries.length === 1
              ? 'There is 1 item that needs your attention'
              : `There are ${entries.length} items that need your attention`}
          </h2>
          <ul className="mt-2 space-y-1">
            {entries.map(([key, message]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => focusField(key)}
                  className="text-left text-sm text-destructive underline underline-offset-4 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                >
                  {message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
})
ErrorSummary.displayName = 'ErrorSummary'
