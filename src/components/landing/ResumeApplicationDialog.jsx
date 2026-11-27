import React, { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, FilePen, ListChecks, Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OTP_EXPIRY_MINUTES } from '@/config/loanProducts'
import { requestOtp, verifyOtp, hydrateDraftFiles, extractDraftErrorMessage } from '@/services/draftApi'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CHOICES = [
  { mode: 'resume', icon: FilePen, title: 'Finish an application I started', description: 'Pick up a draft where you left off, on this device or another.' },
  { mode: 'track', icon: ListChecks, title: 'Track a submitted application', description: 'See its progress and answer anything the lending team has asked.' },
]

/**
 * "My application": one place for an applicant who has been here before. They choose
 * between finishing a draft (email + OTP, then `onResumed` with the recovered draft) and
 * tracking a submitted application (`onTrack` with their email, for /my-applications).
 * `initialMode` skips the choice, e.g. 'resume' from a "finish your application" reminder.
 */
export function ResumeApplicationDialog({ open, onOpenChange, onResumed, onTrack, initialMode = 'choose' }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  // Each opening starts from what the caller asked for.
  useEffect(() => {
    if (open) setMode(initialMode)
  }, [open, initialMode])

  const reset = () => {
    setMode(initialMode)
    setEmail('')
    setOtpSent(false)
    setOtpCode('')
    setError('')
    setSending(false)
    setVerifying(false)
  }

  const handleOpenChange = (next) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const sendOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.')
      return
    }

    setSending(true)
    setError('')
    try {
      await requestOtp(normalizedEmail)
      setOtpSent(true)
    } catch (requestError) {
      setError(extractDraftErrorMessage(requestError))
    } finally {
      setSending(false)
    }
  }

  const handleResend = async () => {
    setOtpCode('')
    await sendOtp()
  }

  const handleVerify = async () => {
    if (!otpCode.trim()) {
      setError('Enter the code sent to your email.')
      return
    }

    setVerifying(true)
    setError('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { draftToken, draft } = await verifyOtp(normalizedEmail, otpCode.trim())
      const hydratedDraft = await hydrateDraftFiles(draft, draftToken)

      onResumed({ ...hydratedDraft, draftToken })
      reset()
      onOpenChange(false)
    } catch (verifyError) {
      setError(extractDraftErrorMessage(verifyError))
    } finally {
      setVerifying(false)
    }
  }

  const handleTrack = () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.')
      return
    }
    onTrack(normalizedEmail)
    handleOpenChange(false)
  }

  const back = () => {
    setMode('choose')
    setOtpSent(false)
    setOtpCode('')
    setError('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (mode === 'track') {
      handleTrack()
    } else if (otpSent) {
      handleVerify()
    } else {
      sendOtp()
    }
  }

  const title = mode === 'track' ? 'Track your application' : mode === 'resume' ? 'Finish your application' : 'My application'
  const description =
    mode === 'choose'
      ? 'Started or sent an application already? Choose what you would like to do.'
      : mode === 'track'
        ? 'Enter the email address you applied with. We will send a code to sign you in.'
        : otpSent
          ? `We sent a six-digit code to ${email}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`
          : 'Enter the email address you used on your application and we will send you a verification code.'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className="grid gap-3">
            {CHOICES.map(({ mode: next, icon: Icon, title: label, description: hint }) => (
              <button
                key={next}
                type="button"
                onClick={() => setMode(next)}
                className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{label}</span>
                  <span className="block text-sm text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'resume' && otpSent ? (
              <div className="space-y-2">
                <Label htmlFor="resume-otp">Verification code</Label>
                <Input
                  id="resume-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'resume-error' : undefined}
                  onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-lg font-semibold tracking-[0.4em]"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="resume-email">Email address</Label>
                <Input
                  id="resume-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'resume-error' : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            )}

            {error ? (
              <p id="resume-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              {initialMode === 'choose' ? (
                <Button type="button" variant="ghost" onClick={back} disabled={sending || verifying}>
                  <ArrowLeft />
                  Back
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              {mode === 'track' ? (
                <Button type="submit">Continue</Button>
              ) : otpSent ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={handleResend} disabled={sending || verifying}>
                    {sending ? <Loader2 className="animate-spin" /> : null}
                    Resend code
                  </Button>
                  <Button type="submit" disabled={verifying || sending}>
                    {verifying ? <Loader2 className="animate-spin" /> : <MailCheck />}
                    {verifying ? 'Verifying…' : 'Verify'}
                  </Button>
                </div>
              ) : (
                <Button type="submit" disabled={sending}>
                  {sending ? <Loader2 className="animate-spin" /> : null}
                  {sending ? 'Sending…' : 'Send me a code'}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
