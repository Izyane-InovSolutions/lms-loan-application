import React, { useEffect, useState } from 'react'
import { Loader2, Mail, MessageSquare, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { NRC_INPUT_PROPS, formatNrc } from '@/utils/nrc'
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
export function VerifyContactForm({ email: givenEmail = '', phone: givenPhone = '', sms = false, editable = false, preferred = null, reference = null, onVerified, onCancel = null, cancelLabel = 'Not now' }) {
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

  // With a customer lookup (`reference`), the ticket records that they chose their own contact.
  const contact = { ...(channel === 'phone' ? { channel, phone } : { channel, email: email.trim() }), ...(reference ? { reference } : {}) }

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
      const { ticket, fill } = await checkVerification(contact, code.trim())
      await onVerified({ ticket, email: email.trim(), phone, fill })
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

const EMAIL_FIELDS = { personal: 'personalInfo.email', business: 'directorInfo.applicantEmail' }

/** Looks the customer up (POST /kyc/lookup): only whether there's a record, and its masked contacts. */
const lookUp = async (idType, id) => {
  const response = await fetch('/api/v1/kyc/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idType, id }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'We couldn’t look you up. Please try again.')
  return data
}

/**
 * The start of an application: before any question, the applicant confirms it's them with
 * a code. With customer lookups on (Settings → Customer records), they give their ID first;
 * if the institution has a record, the code goes to the mobile or email on it, and the form
 * opens filled from it. Otherwise (or by their choice) to an email or phone they type.
 */
export function ConfirmItsYou({ form = 'personal', email, phone, sms = false, kyc = null, saving = false, error = '', onVerified, onResume }) {
  const idTypes = form === 'business' ? ['tpin'] : ['nrc', 'passport']
  const offered = idTypes.filter((type) => kyc?.[type])
  const [step, setStep] = useState(offered.length ? 'id' : 'contact')
  const [idType, setIdType] = useState(offered[0] || null)
  const [id, setId] = useState('')
  const [lookup, setLookup] = useState(null)
  const [busy, setBusy] = useState(false)
  const [stepError, setStepError] = useState('')
  const [verified, setVerified] = useState(null)
  const [ownEmail, setOwnEmail] = useState('')

  const findMe = async (event) => {
    event.preventDefault()
    setBusy(true)
    setStepError('')
    try {
      const result = await lookUp(idType, id)
      setLookup(result)
      setStep(result.found ? 'record' : 'contact')
    } catch (lookupError) {
      setStepError(lookupError.message)
    } finally {
      setBusy(false)
    }
  }

  // Confirmed: on to the form, once there's an email to keep the application under.
  const finish = async (result) => {
    const filledEmail = result.fill?.values?.[EMAIL_FIELDS[form]]
    const emailToUse = result.channel === 'email' ? result.value : result.email || filledEmail
    if (!emailToUse) {
      setVerified(result)
      setStep('email')
      return
    }
    await onVerified({ ...result, email: emailToUse })
  }

  const body = (() => {
    if (saving) {
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Starting your application…
        </p>
      )
    }
    if (step === 'id') {
      return (
        <form onSubmit={findMe} className="space-y-4" noValidate>
          {offered.length > 1 ? (
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1 text-sm font-medium text-foreground">Your ID</legend>
              {offered.map((type) => (
                <label key={type} className="flex items-center gap-2">
                  <input type="radio" name="kyc-id-type" checked={idType === type} onChange={() => {
                      setIdType(type)
                      setId('')
                    }} className="accent-[hsl(var(--primary))]" />
                  {type === 'nrc' ? 'NRC (Zambian)' : 'Passport (not Zambian)'}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="kyc-id" className="block text-sm font-medium text-foreground">
              {idType === 'tpin' ? 'The business’s TPIN' : idType === 'passport' ? 'Passport number' : 'NRC number'}
            </label>
            <Input
              id="kyc-id"
              value={id}
              onChange={(event) => setId(idType === 'nrc' ? formatNrc(event.target.value) : event.target.value)}
              placeholder={idType === 'tpin' ? '1234567890' : idType === 'passport' ? 'ZN123456' : '123456/78/9'}
              {...(idType === 'nrc' ? NRC_INPUT_PROPS : {})}
              autoFocus
            />
          </div>
          {stepError ? (
            <p role="alert" className="text-sm text-destructive">
              {stepError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setStep('contact')}>
              I’ll fill the form in myself
            </Button>
            <Button type="submit" disabled={busy || !id.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
          </div>
        </form>
      )
    }
    if (step === 'record') {
      return <RecordContactForm lookup={lookup} onVerified={finish} onOther={() => setStep('other')} />
    }
    if (step === 'email') {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (EMAIL_PATTERN.test(ownEmail.trim())) onVerified({ ...verified, email: ownEmail.trim() })
            else setStepError('Enter a valid email address, e.g. name@example.com.')
          }}
          className="space-y-3"
          noValidate
        >
          <p className="text-sm text-muted-foreground">Confirmed. Which email address should we keep your application under?</p>
          <Input type="email" aria-label="Email address" value={ownEmail} onChange={(event) => setOwnEmail(event.target.value)} placeholder="name@example.com" autoFocus />
          {stepError ? (
            <p role="alert" className="text-sm text-destructive">
              {stepError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit">Continue</Button>
          </div>
        </form>
      )
    }
    return (
      <div className="space-y-3">
        {lookup && !lookup.found ? <p className="text-sm text-muted-foreground">We couldn’t find your details, so you’ll fill the form in yourself. First, confirm an email address or mobile number.</p> : null}
        {step === 'other' ? <p className="text-sm text-muted-foreground">Confirm an email address or mobile number you use now.</p> : null}
        <VerifyContactForm email={email} phone={phone} sms={sms} editable reference={lookup?.reference || null} onVerified={(result) => finish({ ...result, fill: result.fill ? { ...result.fill } : null })} />
      </div>
    )
  })()

  return (
    <section aria-labelledby="confirm-its-you" className="mx-auto mt-6 max-w-xl rounded-lg border bg-card p-6 shadow-soft">
      <h2 id="confirm-its-you" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        First, confirm it’s you
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {step === 'id'
          ? 'Tell us your ID number. If you already bank with us, we’ll send a code to the contact details we hold and fill in what we know.'
          : 'We’ll send you a code before you start. It stops anyone applying in your name, and lets you carry on later from any device.'}
      </p>
      <div className="mt-5">{body}</div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
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

/** Found on the records: the code to the mobile or email on them (masked), or a different contact. */
function RecordContactForm({ lookup, onVerified, onOther }) {
  const options = [lookup.contacts?.mobile ? 'mobile' : null, lookup.contacts?.email ? 'email' : null].filter(Boolean)
  const [contact, setContact] = useState(options[0])
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const body = { reference: lookup.reference, contact }

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await startVerification(body)
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
      const result = await checkVerification(body, code.trim())
      await onVerified(result)
    } catch (checkError) {
      setError(checkError?.response ? extractDraftErrorMessage(checkError) : checkError.message)
    } finally {
      setBusy(false)
    }
  }

  const where = contact === 'mobile' ? `by text to ${lookup.contacts.mobile}` : `to ${lookup.contacts.email}`
  const alert = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null

  if (sent) {
    return (
      <form onSubmit={confirm} className="space-y-3" noValidate>
        <p className="text-sm text-muted-foreground">We sent a 6-digit code {where}. It expires in 10 minutes.</p>
        <Input aria-label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className="w-40 text-lg tracking-[0.3em]" autoFocus />
        {alert}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={send} disabled={busy}>
            Send a new code
          </Button>
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
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">We found your details. Where should we send the code?</legend>
        {options.map((option) => (
          <label key={option} className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm', contact === option ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
            <input type="radio" name="record-contact" checked={contact === option} onChange={() => setContact(option)} className="accent-[hsl(var(--primary))]" />
            {option === 'mobile' ? <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" /> : <Mail className="size-4 text-muted-foreground" aria-hidden="true" />}
            <span className="font-medium text-foreground">{option === 'mobile' ? 'Text message' : 'Email'}</span>
            <span className="text-muted-foreground">{lookup.contacts[option]} (on our records)</span>
          </label>
        ))}
      </fieldset>
      {alert}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {lookup.otherContactAllowed ? (
          <Button type="button" variant="ghost" onClick={onOther}>
            I don’t have these any more
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Not yours any more? Please contact us to update your details.</p>
        )}
        <Button type="button" onClick={send} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Send the code
        </Button>
      </div>
    </div>
  )
}
