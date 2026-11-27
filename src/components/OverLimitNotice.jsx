import React from 'react'
import { AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * An MoU loan asked for above its pre-approved limit (preApproval.overLimit): it isn't
 * fast-tracked to an offer, and goes through the usual review once the partner answers.
 * Shown wherever the case is looked at, so no one takes it for a pre-approved one.
 */
export function OverLimitNotice({ text, className }) {
  if (!text) return null
  return (
    <div role="note" className={cn('flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm', className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-foreground">
        <span className="font-semibold">Above the pre-approved limit.</span> Goes through the usual review: {text}
      </p>
    </div>
  )
}
