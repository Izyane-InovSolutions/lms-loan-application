import React from 'react'
import { MessageCircle } from 'lucide-react'
import { consentText } from '@/config/consent'
import { useBranding } from '@/components/brand/BrandingProvider'
import { fieldId } from '@/lib/fieldId'

/**
 * Asked on the first step of a self-service application: the applicant agrees that staff
 * may see the unfinished application and contact them to help finish it. Only then does
 * the draft appear in the workspace's pipeline (api/_lib/drafts.js).
 */
export function DraftContactConsent({ checked, onChange, error }) {
  const { name } = useBranding()
  const id = fieldId('contactConsent')
  return (
    <section className="rounded-lg border bg-card p-5 print:hidden">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span className="text-sm">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <MessageCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
            Help with finishing
          </span>
          <span className="mt-0.5 block text-muted-foreground">{consentText('draft_contact', name)}</span>
        </span>
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
