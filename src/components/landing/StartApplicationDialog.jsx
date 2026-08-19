import React, { useEffect, useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DRAFT_RETENTION_DAYS } from '@/config/loanProducts'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Collects the applicant's email before the form opens.
 *
 * The draft sync in useApplicationDraft only begins once a valid email exists, and
 * that field sits deep in the form (step 1 for personal, step 2 for business).
 * Asking here means the cross-device safety net is armed from the first keystroke
 * rather than partway through. Skipping is allowed — local autosave still works,
 * it just cannot be picked up on another device.
 */
export function StartApplicationDialog({ open, onOpenChange, loanType, onStart }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setEmail('')
      setError('')
    }
  }, [open])

  const handleSubmit = (event) => {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalized)) {
      setError('Enter a valid email address, or choose to continue without one.')
      return
    }
    onStart(normalized)
  }

  const label = loanType === 'business' ? 'business loan' : 'personal loan'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start your {label}</DialogTitle>
          <DialogDescription>
            Add your email and we will save your progress as you go, so you can stop at any point and finish on any
            device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="start-email">Email address</Label>
            <Input
              id="start-email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'start-email-error' : 'start-email-hint'}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error ? (
              <p id="start-email-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : (
              <p id="start-email-hint" className="text-xs text-muted-foreground">
                This is also used as the email address on your application.
              </p>
            )}
          </div>

          <div className="flex items-start gap-2.5 rounded-md bg-secondary/60 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              To continue on another device we send a code to this address. Unfinished applications are deleted after{' '}
              {DRAFT_RETENTION_DAYS} days.
            </p>
          </div>

          <div className="grid gap-2">
            <Button type="submit" className="w-full">
              Continue
              <ArrowRight />
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => onStart('')}>
              Continue without saving to another device
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
