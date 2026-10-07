import React from 'react'
import { MessageCircle } from 'lucide-react'
import { consentText } from '@/config/consent'
import { useBranding } from '@/components/brand/BrandingProvider'

/**
 * Shown on the first step of a self-service application when an admin has switched on
 * Help with finishing: staff may see the unfinished application and contact the applicant.
 * It is a notice, not a choice; the draft then appears in the pipeline (api/_lib/drafts.js).
 */
export function DraftContactConsent() {
  const { name } = useBranding()
  return (
    <section className="rounded-lg border bg-card p-5 print:hidden">
      <div className="flex items-start gap-3 text-sm">
        <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium text-foreground">Help with finishing</p>
          <p className="mt-0.5 text-muted-foreground">{consentText('draft_contact', name)}</p>
        </div>
      </div>
    </section>
  )
}
