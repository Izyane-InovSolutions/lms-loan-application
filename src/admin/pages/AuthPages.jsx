import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import { ROLES, roleLabel } from '@/config/roles'
import { api } from '../api'
import { useAuth } from '../auth'
import { Field, FormError, roleTone } from '../components'

/** Two-panel frame for the signed-out pages: a navy brand panel and the form. */
function AuthFrame({ title, description, children, footer }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-[hsl(205_65%_14%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-3 text-sm font-medium text-white/80 hover:text-white">
          <Logo size="sm" showWordmark={false} />
          iZyane loans
        </Link>
        <div className="max-w-sm">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Every application, from first contact to decision, in one place.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/65">
            Agents bring customers in, relationship managers follow their portfolio, and loan officers appraise and
            decide — each with the view their role needs.
          </p>
        </div>
        <p className="text-xs text-white/45">Access is limited to invited staff. Activity is recorded for audit.</p>
        {/* A single quiet arc in the brand red, echoing the rocket in the mark. */}
        <svg aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] text-brand/30" viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="96" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 6" />
        </svg>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo size="sm" showWordmark={false} />
            <span className="font-semibold">Loan workspace</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}

export function LoginPage() {
  const { signIn, verifyTwoFactor, signInAsDemo, demoEnabled, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [demoPending, setDemoPending] = useState(null)
  // Set after a correct password when the account uses two-step sign-in.
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')

  const destination = location.state?.from || '/admin'

  useEffect(() => {
    if (status === 'signed-in') navigate(destination, { replace: true })
  }, [status, destination, navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await signIn(email.trim(), password)
      if (result?.twoFactorRequired) {
        setChallenge(result.challenge)
        setSubmitting(false)
        return
      }
      navigate(destination, { replace: true })
    } catch (signInError) {
      setError(signInError.message)
      setSubmitting(false)
    }
  }

  const handleCode = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await verifyTwoFactor(challenge, code.trim())
      navigate(destination, { replace: true })
    } catch (codeError) {
      setError(codeError.message)
      if (codeError.code === 'challenge_expired' || codeError.code === 'rate_limited') {
        setChallenge(null)
        setCode('')
      }
      setSubmitting(false)
    }
  }

  if (challenge) {
    return (
      <AuthFrame title="Enter your code" description="Open your authenticator app and enter the six-digit code for the loan workspace. Lost your phone? Enter one of your recovery codes.">
        <form onSubmit={handleCode} className="space-y-5" noValidate>
          <Field id="login-code" label="Code">
            <Input
              id="login-code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.slice(0, 12))}
              className="text-center text-lg font-semibold tracking-[0.3em]"
            />
          </Field>
          <FormError message={error} />
          <div className="flex items-center justify-between gap-4">
            <button type="button" onClick={() => { setChallenge(null); setCode(''); setError('') }} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Use a different account
            </button>
            <Button type="submit" disabled={submitting || code.trim().length < 6}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
          </div>
        </form>
      </AuthFrame>
    )
  }

  const tryRole = async (role) => {
    setError('')
    setDemoPending(role)
    try {
      await signInAsDemo(role)
      navigate('/admin', { replace: true })
    } catch (demoError) {
      setError(demoError.message)
      setDemoPending(null)
    }
  }

  return (
    <AuthFrame
      title="Sign in to the loan workspace"
      description="Use the email address your administrator invited."
      footer={
        demoEnabled ? (
          <section aria-labelledby="demo-heading" className="border-t pt-6">
            <h2 id="demo-heading" className="text-sm font-medium text-foreground">
              Or try a role with sample data
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Demo access is on for this environment. Nothing you do here reaches real customers.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {['admin', 'loan_officer', 'sales_manager', 'rm', 'dsa'].map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => tryRole(role)}
                  disabled={Boolean(demoPending) || submitting}
                  className="group flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', roleTone(role).dot)} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {roleLabel(role)}
                      {demoPending === role ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{ROLES[role].description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Field id="login-email" label="Work email">
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field id="login-password" label="Password">
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <FormError message={error} />
        <div className="flex items-center justify-between gap-4">
          <Link to="/admin/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
          <Button type="submit" disabled={submitting || !email || !password}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Sign in
          </Button>
        </div>
      </form>
    </AuthFrame>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sentMessage, setSentMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const { message } = await api('/auth/password/forgot', { method: 'POST', body: { email: email.trim() } })
      setSentMessage(message)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFrame
      title="Reset your password"
      description="We’ll email you a link to choose a new one. It works for an hour."
      footer={
        <Link to="/admin/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      {sentMessage ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border bg-success/5 p-4 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-foreground">{sentMessage}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <Field id="forgot-email" label="Work email">
            <Input id="forgot-email" type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={submitting || !email}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}

const MIN_PASSWORD = 12

/** Landing page for invite and reset links: /admin/set-password?token=… */
export function SetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { acceptSession } = useAuth()
  const navigate = useNavigate()
  const [details, setDetails] = useState({ status: 'loading' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    api(`/auth/password/token?token=${encodeURIComponent(token)}`)
      .then((data) => !cancelled && setDetails({ status: 'ready', ...data }))
      .catch((tokenError) => !cancelled && setDetails({ status: 'invalid', message: tokenError.message }))
    return () => {
      cancelled = true
    }
  }, [token])

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && confirm !== password

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD || password !== confirm) return
    setError('')
    setSubmitting(true)
    try {
      await api('/auth/password/set', { method: 'POST', body: { token, password } })
      await acceptSession()
      navigate('/admin', { replace: true })
    } catch (submitError) {
      setError(submitError.message)
      setSubmitting(false)
    }
  }

  if (details.status === 'loading') {
    return (
      <AuthFrame title="Checking your link…">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </AuthFrame>
    )
  }

  if (details.status === 'invalid') {
    return (
      <AuthFrame
        title="This link no longer works"
        description={details.message}
        footer={
          <Link to="/admin/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Request a new link
          </Link>
        }
      />
    )
  }

  const isInvite = details.purpose === 'invite'
  return (
    <AuthFrame
      title={isInvite ? `Welcome, ${details.name.split(' ')[0]}` : 'Choose a new password'}
      description={
        isInvite
          ? `You’ve been invited as ${roleLabel(details.role).toLowerCase()}. Choose a password to finish setting up ${details.email}.`
          : `For ${details.email}. You’ll be signed out everywhere else.`
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Field
          id="new-password"
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters. A short phrase is easier to remember than symbols.`}
          error={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : ''}
        >
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            aria-invalid={tooShort}
            aria-describedby={tooShort ? 'new-password-error' : 'new-password-hint'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field id="confirm-password" label="Confirm password" error={mismatch ? 'The passwords don’t match.' : ''}>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={mismatch}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={submitting || password.length < MIN_PASSWORD || password !== confirm}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {isInvite ? 'Set password and continue' : 'Save new password'}
        </Button>
      </form>
    </AuthFrame>
  )
}
