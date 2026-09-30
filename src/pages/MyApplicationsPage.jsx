import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Check, CircleAlert, FileText, Inbox, Loader2, LogOut, MailCheck, Paperclip, Send, Upload } from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatKwacha } from '@/config/loanProducts'
import { LOAN_TYPE_LABELS } from '@/config/applications'
import { api } from '@/admin/api'
import { SignaturePad } from '@/components/application/SignaturePad'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const dateLabel = (value) =>
  value ? new Date(value).toLocaleDateString('en-ZM', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

/**
 * The applicant's own page: sign in with an emailed code, see each application's
 * progress in plain words, and answer when a loan officer asks for something.
 */
export default function MyApplicationsPage() {
  const location = useLocation()
  const [session, setSession] = useState({ status: 'loading', user: null })

  const refreshSession = useCallback(async () => {
    const { user } = await api('/auth/me').catch(() => ({ user: null }))
    setSession({ status: user?.role === 'customer' ? 'signed-in' : 'signed-out', user })
  }, [])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    setSession({ status: 'signed-out', user: null })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 font-semibold">
            <Logo size="sm" showWordmark={false} />
            Loan Origination
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Home</Link>
          </Button>
        </div>
      </header>
      <main className="container flex-1 py-10 sm:py-14">
        {session.status === 'loading' ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : session.status === 'signed-in' ? (
          <Applications user={session.user} onSignOut={signOut} />
        ) : (
          <SignIn initialEmail={location.state?.email || ''} onSignedIn={refreshSession} staffUser={session.user} />
        )}
      </main>
      <SiteFooter />
    </div>
  )
}

function SignIn({ initialEmail, onSignedIn, staffUser }) {
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('email')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async (event) => {
    event?.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalized)) {
      setError('Enter the email address you applied with.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: normalized, purpose: 'login' }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'We could not send a code. Try again.')
      setStage('code')
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/auth/customer', { method: 'POST', body: { email: email.trim().toLowerCase(), code: code.trim() } })
      await onSignedIn()
    } catch (verifyError) {
      setError(verifyError.message)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">Your applications</h1>
      <p className="mt-2 text-muted-foreground">
        {stage === 'email'
          ? 'Enter the email address you applied with. We’ll send you a code to sign in — no password needed.'
          : `We sent a six-digit code to ${email.trim()}. It expires in 10 minutes.`}
      </p>
      {staffUser ? (
        <p className="mt-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          You’re signed in to the staff workspace. <Link to="/admin" className="font-medium text-primary underline-offset-4 hover:underline">Go to the workspace</Link>
        </p>
      ) : null}
      <form onSubmit={stage === 'email' ? sendCode : verify} className="mt-8 space-y-4" noValidate>
        {stage === 'email' ? (
          <div className="space-y-2">
            <Label htmlFor="my-email">Email address</Label>
            <Input id="my-email" type="email" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="my-code">Code</Label>
            <Input
              id="my-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-lg font-semibold tracking-[0.4em]"
            />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          {stage === 'code' ? (
            <Button type="button" variant="outline" onClick={() => sendCode()} disabled={busy}>
              Send a new code
            </Button>
          ) : null}
          <Button type="submit" className="flex-1" disabled={busy || (stage === 'code' && code.length < 6)}>
            {busy ? <Loader2 className="animate-spin" /> : stage === 'email' ? null : <MailCheck />}
            {stage === 'email' ? 'Send me a code' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Applications({ user, onSignOut }) {
  const [state, setState] = useState({ status: 'loading' })
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await api('/me/applications')
      setState({ status: 'ready', ...data })
    } catch (error) {
      setState({ status: 'error', message: error.message })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (openId) return <ApplicationDetail id={openId} email={user.email} onBack={() => { setOpenId(null); load() }} />

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your applications</h1>
          <p className="mt-1 text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/">Apply again</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut />
            Sign out
          </Button>
        </div>
      </div>

      {state.status === 'loading' ? (
        <Loader2 className="mt-10 size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : state.status === 'error' ? (
        <p role="alert" className="mt-8 text-destructive">{state.message}</p>
      ) : state.applications.length === 0 && state.earlier.length === 0 ? (
        <div className="mt-10 rounded-xl border p-10 text-center">
          <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-medium">No applications for this email yet</p>
          <p className="mt-1 text-sm text-muted-foreground">If you applied with a different address, sign out and use that one.</p>
        </div>
      ) : (
        <>
          <ul className="mt-8 space-y-4">
            {state.applications.map((application) => (
              <li key={application.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(application.id)}
                  className={cn(
                    'w-full rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    application.status === 'info_requested' && 'border-warning/60 bg-warning/5',
                    application.offer && 'border-success/60 bg-success/5'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">
                        {formatKwacha(application.amount)} {LOAN_TYPE_LABELS[application.loanType].toLowerCase()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {application.reference}, submitted {dateLabel(application.submittedAt)}
                      </p>
                    </div>
                    <StatusPill application={application} />
                  </div>
                  <Progress status={application.status} />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {application.status === 'info_requested' || application.offer ? <span className="font-medium text-foreground">Action needed: </span> : null}
                    {application.statusDetail}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {state.earlier.length ? (
            <section className="mt-10">
              <h2 className="text-base font-semibold">Earlier applications</h2>
              <p className="text-sm text-muted-foreground">Made before this page existed. Contact us for details.</p>
              <ul className="mt-3 divide-y rounded-xl border">
                {state.earlier.map((application) => (
                  <li key={application.reference} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span>
                      {application.reference}, {application.amount ? formatKwacha(application.amount) : ''} {LOAN_TYPE_LABELS[application.loanType]?.toLowerCase()}
                    </span>
                    <span className="text-muted-foreground">{application.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

const TONE = {
  accepted: 'bg-success/15 text-success',
  withdrawn: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
  submitted: 'bg-secondary text-secondary-foreground',
  in_review: 'bg-accent text-accent-foreground',
  pending_approval: 'bg-accent text-accent-foreground',
  info_requested: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  disbursed: 'bg-success/15 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function StatusPill({ application }) {
  return <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', TONE[application.status])}>{application.statusLabel}</span>
}

// The applicant's view of the journey has three stops; the internal stages map onto them.
const STAGES = ['Received', 'Being reviewed', 'Decision']
const stageIndex = (status) => (status === 'submitted' ? 0 : ['approved', 'accepted', 'declined', 'disbursed', 'withdrawn', 'expired'].includes(status) ? 2 : 1)

function Progress({ status }) {
  const current = stageIndex(status)
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Progress">
      {STAGES.map((stage, index) => (
        <li key={stage} className="space-y-1.5">
          <span className={cn('block h-1.5 rounded-full', index <= current ? (['declined', 'withdrawn', 'expired'].includes(status) && index === 2 ? 'bg-muted-foreground/60' : 'bg-primary') : 'bg-muted')} />
          <span className={cn('block text-xs', index <= current ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {stage}
            {index === current ? <span className="sr-only"> (current)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

function ApplicationDetail({ id, email, onBack }) {
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const data = await api(`/me/applications/${id}`)
      setState({ status: 'ready', ...data })
    } catch (error) {
      setState({ status: 'error', message: error.message })
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto max-w-3xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All applications
      </button>
      {state.status === 'loading' ? (
        <Loader2 className="mt-10 size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : state.status === 'error' ? (
        <p role="alert" className="mt-8 text-destructive">{state.message}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {formatKwacha(state.application.amount)} {LOAN_TYPE_LABELS[state.application.loanType].toLowerCase()}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {state.application.reference}, {state.application.tenure} months, about {formatKwacha(Math.round(state.application.monthlyInstalment))} a month
              </p>
            </div>
            <StatusPill application={state.application} />
          </div>
          <Progress status={state.application.status} />

          {state.application.offer ? <OfferPanel application={state.application} documents={state.offerDocuments || []} email={email} onDone={load} /> : null}
          {!state.application.offer && state.offerDocuments?.length ? <OfferDocuments documents={state.offerDocuments} applicationId={state.application.id} title="Your loan documents" /> : null}
          {state.application.infoRequest ? <RespondToRequest application={state.application} onDone={load} /> : null}

          <section className="mt-10">
            <h2 className="text-base font-semibold">What’s happened</h2>
            <ol className="relative mt-4 space-y-5 before:absolute before:inset-y-2 before:left-[5px] before:w-px before:bg-border">
              {state.events.map((event) => (
                <li key={event.id} className="relative pl-6">
                  <span className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-background bg-primary/70" aria-hidden="true" />
                  <p className="text-sm">{event.message}</p>
                  <p className="text-xs text-muted-foreground">{dateLabel(event.at)}</p>
                </li>
              ))}
            </ol>
          </section>

          {state.application.canWithdraw && !state.application.offer ? <WithdrawLink application={state.application} onDone={load} /> : null}

          <section className="mt-10">
            <h2 className="text-base font-semibold">Documents you sent</h2>
            <ul className="mt-3 divide-y rounded-xl border">
              {state.documents.map((document) => (
                <li key={document.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{document.label}</span>
                  <a
                    href={`/api/v1/applications/${state.application.id}/documents/${document.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

/** The offer letter and agreement (and, once signed, the signed copies), to open and keep. */
function OfferDocuments({ documents, applicationId, title, opened = {}, onOpen }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 divide-y rounded-xl border bg-card">
        {documents.map((document) => (
          <li key={document.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{document.label}</span>
            {opened[document.id] ? <Check className="size-4 shrink-0 text-success" aria-label="Opened" /> : null}
            <a
              href={`/api/v1/applications/${applicationId}/documents/${document.id}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOpen?.(document.id)}
              className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
            >
              {document.signed ? 'Download' : 'Read'}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The approved offer: its terms, its documents, and accepting (by signing, where the
 * lender requires it) or turning it down.
 */
function OfferPanel({ application, documents, email, onDone }) {
  const offer = application.offer
  const signing = offer.requireSignature
  const [agreed, setAgreed] = useState(false)
  const [opened, setOpened] = useState({})
  const [name, setName] = useState('')
  const [signature, setSignature] = useState(null)
  const [code, setCode] = useState('')
  const [codeState, setCodeState] = useState({ status: 'idle', message: '' })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [confirmDecline, setConfirmDecline] = useState(false)

  const run = async (key, path, body) => {
    setBusy(key)
    setError('')
    try {
      await api(path, { method: 'POST', body })
      onDone()
    } catch (runError) {
      setError(runError.message)
      setBusy(null)
    }
  }

  const sendCode = async () => {
    setCodeState({ status: 'sending', message: '' })
    const response = await fetch('/api/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, purpose: 'sign' }) })
    const result = await response.json().catch(() => ({}))
    setCodeState(response.ok ? { status: 'sent', message: `We emailed a code to ${email}.` } : { status: 'error', message: result.message || 'The code could not be sent.' })
  }

  const allRead = documents.length > 0 && documents.every((document) => opened[document.id])
  const ready = signing ? agreed && name.trim().length >= 3 && signature && code.length === 6 : agreed

  const accept = () =>
    run('accept', `/me/applications/${application.id}/accept`, signing ? { agreed: true, code, signature: { name: name.trim(), ...signature } } : { agreed: true })

  return (
    <section aria-labelledby="offer-title" className="mt-8 rounded-xl border border-success/40 bg-success/5 p-5">
      <h2 id="offer-title" className="flex items-center gap-2 font-semibold">
        <Check className="size-4 text-success" aria-hidden="true" />
        Your loan offer
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Amount', formatKwacha(offer.amount)],
          ['Tenure', `${offer.tenure} months`],
          ['Monthly instalment', formatKwacha(Math.round(offer.monthlyInstalment))],
          ['Total repayable', formatKwacha(Math.round(offer.totalRepayable))],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {offer.amount !== application.amount ? (
        <p className="mt-3 text-sm text-muted-foreground">This is different from the {formatKwacha(application.amount)} you asked for.</p>
      ) : null}
      {offer.conditions ? <p className="mt-3 text-sm"><span className="font-medium">Conditions: </span>{offer.conditions}</p> : null}
      <p className="mt-3 text-sm text-muted-foreground">Accept by {dateLabel(offer.expiresAt)}, or the offer lapses.</p>

      {documents.length ? (
        <OfferDocuments documents={documents} applicationId={application.id} title="Read before you accept" opened={opened} onOpen={(id) => setOpened((prev) => ({ ...prev, [id]: true }))} />
      ) : signing ? (
        <p className="mt-6 text-sm text-muted-foreground">Your offer letter and loan agreement are being prepared. Refresh in a minute.</p>
      ) : null}

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
        <span>
          {signing
            ? 'I have read the offer letter and loan agreement. I accept this loan on these terms, and agree to repay it in the monthly instalments shown.'
            : 'I accept this loan on these terms, and agree to repay it in the monthly instalments shown.'}
        </span>
      </label>
      {signing && documents.length && !allRead ? <p className="ml-7 mt-1 text-xs text-muted-foreground">Open each document above to read it.</p> : null}

      {signing ? (
        <div className="mt-5 space-y-4 rounded-lg border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="sign-name">Your full name</Label>
            <Input id="sign-name" value={name} maxLength={100} autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Your signature</p>
            <SignaturePad name={name} onChange={setSignature} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sign-code">Code from your email</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="sign-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-40 text-center font-semibold tracking-[0.3em]"
              />
              <Button type="button" variant="outline" size="sm" onClick={sendCode} disabled={codeState.status === 'sending'}>
                {codeState.status === 'sending' ? <Loader2 className="animate-spin" /> : <MailCheck />}
                {codeState.status === 'sent' ? 'Send another code' : 'Email me a code'}
              </Button>
            </div>
            {codeState.message ? <p className={cn('text-xs', codeState.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{codeState.message}</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Signing adds your signature, the time and a record of this device to signed copies of both documents, which you can download afterwards.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={accept} disabled={!ready || Boolean(busy)}>
          {busy === 'accept' ? <Loader2 className="animate-spin" /> : <Check />}
          {signing ? 'Sign and accept' : 'Accept the offer'}
        </Button>
        {confirmDecline ? (
          <Button variant="destructive" onClick={() => run('decline', `/me/applications/${application.id}/withdraw`, { reason: 'Turned down the offer' })} disabled={Boolean(busy)}>
            {busy === 'decline' ? <Loader2 className="animate-spin" /> : null}
            Yes, turn it down
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDecline(true)} disabled={Boolean(busy)}>
            Turn it down
          </Button>
        )}
      </div>
    </section>
  )
}

function WithdrawLink({ application, onDone }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const withdraw = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/me/applications/${application.id}/withdraw`, { method: 'POST', body: { reason } })
      onDone()
    } catch (withdrawError) {
      setError(withdrawError.message)
      setBusy(false)
    }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-6 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Withdraw this application
      </button>
    )
  }
  return (
    <div className="mt-6 space-y-3 rounded-xl border p-4">
      <Label htmlFor="withdraw-reason" className="text-sm">
        Why are you withdrawing? (optional)
      </Label>
      <Input id="withdraw-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          Keep it
        </Button>
        <Button variant="destructive" size="sm" onClick={withdraw} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Withdraw
        </Button>
      </div>
    </div>
  )
}

/** Answering "we need something from you": attach files one at a time, add a note, send. */
function RespondToRequest({ application, onDone }) {
  const [message, setMessage] = useState('')
  const [attached, setAttached] = useState([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setError('That file is larger than 4 MB. Upload a smaller scan or photo.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('label', file.name)
      form.append('file', file)
      const response = await fetch(`/api/v1/me/applications/${application.id}/documents`, { method: 'POST', body: form, credentials: 'same-origin' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'The upload failed. Try again.')
      setAttached((current) => [...current, body.document])
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
    }
  }

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await api(`/me/applications/${application.id}/respond`, { method: 'POST', body: { message } })
      onDone()
    } catch (sendError) {
      setError(sendError.message)
      setSending(false)
    }
  }

  return (
    <section aria-labelledby="request-title" className="mt-8 rounded-xl border border-warning/50 bg-warning/5 p-5">
      <h2 id="request-title" className="flex items-center gap-2 font-semibold">
        <CircleAlert className="size-4 text-warning" aria-hidden="true" />
        We need something from you
      </h2>
      <p className="mt-2 text-sm">{application.infoRequest.message}</p>
      <div className="mt-4 space-y-3">
        <Label htmlFor="reply" className="text-sm">
          Your reply (optional)
        </Label>
        <textarea
          id="reply"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {attached.length ? (
          <ul className="space-y-1 text-sm">
            {attached.map((document) => (
              <li key={document.id} className="flex items-center gap-2">
                <Check className="size-4 text-success" aria-hidden="true" />
                {document.filename}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept=".pdf,image/*" className="sr-only" onChange={upload} aria-label="Attach a document" />
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : attached.length ? <Paperclip /> : <Upload />}
            {attached.length ? 'Attach another' : 'Attach a document'}
          </Button>
          <Button type="button" onClick={send} disabled={sending || uploading || (!message.trim() && !attached.length)}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Send reply
          </Button>
        </div>
      </div>
    </section>
  )
}
