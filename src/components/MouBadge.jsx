import React from 'react'
import { Handshake } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Whether a product is an MoU loan: pre-approved for a partner's employees (src/config/partners.js). */
export const isMouProduct = (product) => Boolean(product?.preApproval?.enabled)

/**
 * The mark of an MoU loan, wherever loans are listed: "MoU loan", or "MoU · Zesco Limited
 * staff" when the partner is known, so an applicant sees who it is for.
 */
export function MouBadge({ partnerName, className }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-brand-foreground shadow-sm ring-1 ring-inset ring-black/10', className)}
      title={partnerName ? `Pre-approved under an MoU with ${partnerName}, for their staff` : 'Pre-approved under an MoU with an employer, for their staff'}
    >
      <Handshake className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      {partnerName ? `MoU · ${partnerName} staff` : 'MoU loan'}
    </span>
  )
}
