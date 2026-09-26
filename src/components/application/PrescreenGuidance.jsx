import React from 'react'
import { Lightbulb, Loader2 } from 'lucide-react'

/**
 * Applicant-facing half of the AI prescreen, shown on the Overview step.
 *
 * Only `applicantGuidance` is rendered. The recommendation and risk level are for
 * underwriters and go to the LMS; they must never appear here. Renders nothing on
 * failure, when AI is not configured, or when there is nothing to suggest — so a
 * missing card never reads as a problem with the application.
 */
export function PrescreenGuidance({ status, guidance }) {
  if (status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground print:hidden">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Looking over your application for anything worth fixing before you submit…
      </p>
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
