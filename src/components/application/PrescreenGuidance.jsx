import React from 'react'
import { AlertCircle, Lightbulb, Loader2, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Applicant-facing half of the AI prescreen, shown on the Overview step.
 *
 * Only `applicantGuidance` is rendered. The recommendation and risk level are for
 * underwriters and go to the LMS; they must never appear here. Renders nothing when AI
 * is not configured or there is nothing to suggest. A failure is shown with its reason
 * (`message`) and a retry when one could help — staying silent made a provider billing
 * problem look exactly like "AI is off" — alongside a clear line that the applicant
 * can still submit.
 */
export function PrescreenGuidance({ status, guidance, message, onRetry }) {
  if (status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground print:hidden">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Looking over your application for anything worth fixing before you submit…
      </p>
    )
  }

  if (status === 'error') {
    return (
      <section
        aria-labelledby="prescreen-error-title"
        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/40 p-4 print:hidden"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="prescreen-error-title" className="text-sm font-medium text-foreground">
              We couldn’t run the automatic review
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {message} You can still submit your application — the review is optional.
            </p>
          </div>
        </div>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCw />
            Try again
          </Button>
        ) : null}
      </section>
    )
  }

  if (status !== 'done' || !guidance?.length) return null

  return (
    <section
      aria-labelledby="prescreen-guidance-title"
      className="rounded-lg border border-warning/40 bg-warning/10 p-5 print:hidden"
    >
      <h2 id="prescreen-guidance-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <Lightbulb className="size-4 text-warning" aria-hidden="true" />
        Before you submit
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground">
        {guidance.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        These are automated suggestions to help your application go through smoothly. You can still submit as it is.
      </p>
    </section>
  )
}
