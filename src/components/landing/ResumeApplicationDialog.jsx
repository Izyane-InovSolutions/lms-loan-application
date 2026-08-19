import React, { useState } from 'react'
import { Loader2, MailCheck } from 'lucide-react'

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

/**
 * Two-stage email + OTP flow for picking up a draft on another device.
 * Owns only the exchange; the caller decides what to do with the recovered draft.
 */
export function ResumeApplicationDialog({ open, onOpenChange, onResumed }) {
  const [email, setEmail] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const reset = () => {
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
      const hydratedDraft = await hydrateDraftFiles(draft)

      onResumed({ ...hydratedDraft, draftToken })
      reset()
      onOpenChange(false)
    } catch (verifyError) {
      setError(extractDraftErrorMessage(verifyError))
    } finally {
      setVerifying(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (otpSent) {
      handleVerify()
    } else {
      sendOtp()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resume your application</DialogTitle>
          <DialogDescription>
            {otpSent
              ? `We sent a six-digit code to ${email}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`
              : 'Enter the email address you used on your application and we will send you a verification code.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {otpSent ? (
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

          <DialogFooter>
            {otpSent ? (
              <>
                <Button type="button" variant="outline" onClick={handleResend} disabled={sending || verifying}>
                  {sending ? <Loader2 className="animate-spin" /> : null}
                  Resend code
                </Button>
                <Button type="submit" disabled={verifying || sending}>
                  {verifying ? <Loader2 className="animate-spin" /> : <MailCheck />}
                  {verifying ? 'Verifying…' : 'Verify and continue'}
                </Button>
              </>
            ) : (
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? <Loader2 className="animate-spin" /> : null}
                {sending ? 'Sending…' : 'Send me a code'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
