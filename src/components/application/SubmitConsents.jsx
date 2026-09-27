import React from 'react'
import { Loader2, MapPin, ShieldCheck, UserCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CONSENT_NOTICES } from '@/config/consent'

/**
 * The choices made at submission, on the Overview step: optional location sharing,
 * credit bureau consent where a bureau is connected, and — when an agent is filling it
 * in — the code the customer reads back to show they agree. Terms and data processing
 * are accepted in the terms dialog on submit.
 */
export function SubmitConsents({
  shareLocation,
  onShareLocation,
  allowCrb,
  onAllowCrb,
  crbEnabled,
  assistedBy,
  customerEmail,
  consentCode,
  onConsentCode,
  consentCodeState,
  onSendConsentCode,
}) {
  return (
    <section aria-labelledby="submit-consents-title" className="space-y-4 rounded-lg border bg-card p-5 print:hidden">
      <h2 id="submit-consents-title" className="text-base font-semibold tracking-tight">
        Before you submit
      </h2>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={shareLocation}
          onChange={(event) => onShareLocation(event.target.checked)}
        />
        <span className="text-sm">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {assistedBy ? 'Record where we met' : 'Share my location'}
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            {assistedBy
              ? 'Your device’s location is saved with the application as the place you met the customer.'
              : CONSENT_NOTICES.location.text}
          </span>
        </span>
      </label>

      {crbEnabled ? (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-[hsl(var(--primary))]"
            checked={allowCrb}
            onChange={(event) => onAllowCrb(event.target.checked)}
          />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Allow a credit bureau check
            </span>
            <span className="mt-0.5 block text-muted-foreground">{CONSENT_NOTICES.crb.text}</span>
          </span>
        </label>
      ) : null}

      {assistedBy ? (
        <div className="rounded-md border border-primary/25 bg-primary/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <UserCheck className="size-4 text-primary" aria-hidden="true" />
            The customer’s agreement
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            We email the customer a code. When they read it to you, enter it here — it shows they agree to this application
            and the terms.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSendConsentCode}
              disabled={consentCodeState.status === 'sending' || !customerEmail}
            >
              {consentCodeState.status === 'sending' ? <Loader2 className="animate-spin" /> : null}
              {consentCodeState.status === 'sent' ? 'Send another code' : 'Email the code'}
            </Button>
            <Input
              aria-label="Customer’s code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={consentCode}
              onChange={(event) => onConsentCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-9 text-center font-semibold tracking-[0.3em] sm:w-40"
            />
          </div>
          {consentCodeState.message ? (
            <p role={consentCodeState.status === 'error' ? 'alert' : 'status'} className={consentCodeState.status === 'error' ? 'mt-2 text-sm text-destructive' : 'mt-2 text-sm text-muted-foreground'}>
              {consentCodeState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
