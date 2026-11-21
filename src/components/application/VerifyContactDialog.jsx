import React, { useEffect, useState } from 'react'
import { Loader2, Mail, MessageSquare, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { checkVerification, extractDraftErrorMessage, startVerification } from '@/services/draftApi'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phoneDigits = (phone) => String(phone || '').replace(/\D/g, '')

/** +260 97…456, for saying where a text went without showing the whole number. */
const maskPhone = (phone) => {
  const digits = phoneDigits(phone).slice(-9)
  return digits.length === 9 ? `+260 ${digits.slice(0, 2)}…${digits.slice(-3)}` : phone
}

/**
 * The code steps of "Confirm it's you" (api/_lib/verification.js): where to send it (email,
 * or a text when the workspace can send them), then the code. With `editable`, the applicant
 * types their email and phone here; otherwise the form's are used. Hands `onVerified` the
 * ticket from the check with the email and phone it was for.
 */
export function VerifyContactForm({ email: givenEmail = '', phone: givenPhone = '', sms = false, editable = false, preferred = null, onVerified, onCancel = null, cancelLabel = 'Not now' }) {
  const [email, setEmail] = useState(givenEmail || '')
  const [phone, setPhone] = useState(givenPhone || '')
  const phoneUsable = sms && phoneDigits(phone).length >= 9
  const [channel, setChannel] = useState(preferred === 'phone' && phoneUsable ? 'phone' : 'email')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (channel === 'phone' && !phoneUsable) setChannel('email')
  }, [channel, phoneUsable])

  const contact = channel === 'phone' ? { channel, phone } : { channel, email: email.trim() }

  const send = async () => {
    setError('')
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Enter a valid email address, e.g. name@example.com.')
      return
    }
    setBusy(true)
    try {
      await startVerification(contact)
      setSent(true)
    } catch (sendError) {
      setError(extractDraftErrorMessage(sendError))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { ticket } = await checkVerification(contact, code.trim())
      await onVerified({ ticket, email: email.trim(), phone })
    } catch (checkError) {
      setError(checkError?.response ? extractDraftErrorMessage(checkError) : checkError.message)
    } finally {
      setBusy(false)
    }
  }

  const alert = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null

  if (sent) {
    return (
      <form onSubmit={confirm} className="space-y-3" noValidate>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code {channel === 'phone' ? `by text to ${maskPhone(phone)}` : `to ${email.trim()}`}. It expires in 10 minutes.
        </p>
        <label htmlFor="verify-code" className="block text-sm font-medium text-foreground">
          Code
        </label>
        <Input
          id="verify-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          className="w-40 text-lg tracking-[0.3em]"
          autoFocus
        />
        {alert}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={send} disabled={busy}>
              Send a new code
            </Button>
            {editable ? (
              <Button type="button" variant="ghost" onClick={() => setSent(false)} disabled={busy}>
                Change details
              </Button>
            ) : null}
          </div>
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Confirm
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4">
      {editable ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="verify-email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <Input id="verify-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          </div>
          {sms ? (
            <div className="space-y-1.5">
              <label htmlFor="verify-phone" className="block text-sm font-medium text-foreground">
                Mobile number <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input id="verify-phone" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="97 123 4567" />
            </div>
          ) : null}
        </div>
      ) : null}

      {phoneUsable ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Where should we send the code?</legend>
          {[
            { id: 'email', icon: Mail, label: 'Email', detail: email.trim() },
            { id: 'phone', icon: MessageSquare, label: 'Text message', detail: maskPhone(phone) },
          ].map((option) => (
            <label
              key={option.id}
              className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm', channel === option.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
            >
              <input type="radio" name="verify-channel" value={option.id} checked={channel === option.id} onChange={() => setChannel(option.id)} className="accent-[hsl(var(--primary))]" />
              <option.icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-foreground">{option.label}</span>
              <span className="truncate text-muted-foreground">{option.detail}</span>
            </label>
          ))}
        </fieldset>
      ) : !editable ? (
        <p className="text-sm text-muted-foreground">We’ll email a 6-digit code to {email.trim()}.</p>
      ) : null}

      {alert}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button type="button" onClick={send} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Send the code
        </Button>
      </div>
    </div>
  )
}

/**
 * "Confirm it's you" as a dialog: for an applicant who changed the contact details they
 * confirmed, or who reached a save without the start screen (ConfirmItsYou).
 */
export function VerifyContactDialog({ open, email, phone, sms = false, preferred = null, reason = 'start', onVerified, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Confirm it’s you
          </DialogTitle>
          <DialogDescription>
            {reason === 'changed'
              ? 'You changed the contact details you confirmed. Confirm the new ones with a code before you submit.'
              : 'Before we save your application, confirm these contact details are yours. It stops anyone applying in your name.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so each opening starts at the first step. */}
        {open ? <VerifyContactForm key={`${email}-${phone}`} email={email} phone={phone} sms={sms} preferred={preferred} onVerified={({ ticket }) => onVerified(ticket)} onCancel={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The start of an application: before any question, the applicant confirms an email (or
 * phone, by text) is theirs with a code. The form then opens with them filled in.
 */
export function ConfirmItsYou({ email, phone, sms = false, saving = false, error = '', onVerified, onResume }) {
  return (
    <section aria-labelledby="confirm-its-you" className="mx-auto mt-6 max-w-xl rounded-lg border bg-card p-6 shadow-soft">
      <h2 id="confirm-its-you" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        First, confirm it’s you
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We’ll send you a code before you start. It stops anyone applying in your name, and lets you carry on later from any device.
      </p>
      <div className="mt-5">
        {saving ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Starting your application…
          </p>
        ) : (
          // Keyed: an email seeded into the form after this opened (from the landing page) fills it in.
          <VerifyContactForm key={email || ''} email={email} phone={phone} sms={sms} editable onVerified={onVerified} />
        )}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {onResume ? (
        <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
          Already started one?{' '}
          <button type="button" onClick={onResume} className="font-medium text-primary underline-offset-4 hover:underline">
            Resume your application
          </button>
        </p>
      ) : null}
    </section>
  )
}
