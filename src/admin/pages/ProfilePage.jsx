import React, { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, KeyRound, Loader2, LogOut, Monitor, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { roleLabel } from '@/config/roles'
import { api } from '../api'
import { useAuth } from '../auth'
import { Field, FormError, PageHeader, Panel, timeAgo, useToast } from '../components'

/** Your account: notification emails, two-step sign-in and the browsers you are signed in on. */
export function ProfilePage() {
  const { user, refresh } = useAuth()
  const notify = useToast()
  return (
    <div className="space-y-6">
      <PageHeader title="Your profile" description={`${user.name}, ${roleLabel(user.role).toLowerCase()} — ${user.email}`} />
      {user.twoFactorSetupRequired ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Your role needs two-step sign-in. Set it up below to carry on using the workspace.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <TwoFactorPanel user={user} onChange={refresh} notify={notify} />
        <div className="space-y-6">
          <EmailPreference user={user} onChange={refresh} notify={notify} />
          <SessionsPanel notify={notify} />
        </div>
      </div>
    </div>
  )
}

function EmailPreference({ user, onChange, notify }) {
  const [saving, setSaving] = useState(false)
  const enabled = user.notificationPrefs?.email !== false
  const toggle = async () => {
    setSaving(true)
    try {
      await api('/me/preferences', { method: 'PUT', body: { email: !enabled } })
      await onChange()
      notify(enabled ? 'Notification emails off' : 'Notification emails on')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Panel title="Notification emails">
      <p className="text-sm text-muted-foreground">
        {enabled ? 'You get an email for each notification, as well as the bell.' : 'You only see notifications on the bell.'}
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={toggle} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        {enabled ? 'Turn emails off' : 'Turn emails on'}
      </Button>
    </Panel>
  )
}

function TwoFactorPanel({ user, onChange, notify }) {
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState(null)
  const [disabling, setDisabling] = useState(false)
  const [proof, setProof] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setError('')
    setBusy(true)
    try {
      const data = await api('/auth/2fa/setup', { method: 'POST' })
      setSetup({ ...data, qr: await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 }) })
    } catch (startError) {
      setError(startError.message)
    } finally {
      setBusy(false)
    }
  }

  const enable = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { recoveryCodes: codes } = await api('/auth/2fa/enable', { method: 'POST', body: { code } })
      setRecoveryCodes(codes)
      setSetup(null)
      setCode('')
      await onChange()
      notify('Two-step sign-in is on')
    } catch (enableError) {
      setError(enableError.message)
    } finally {
      setBusy(false)
    }
  }

  const disable = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body = /^\d{6}$/.test(proof.trim()) ? { code: proof.trim() } : { password: proof }
      await api('/auth/2fa/disable', { method: 'POST', body })
      setDisabling(false)
      setProof('')
      await onChange()
      notify('Two-step sign-in is off')
    } catch (disableError) {
      setError(disableError.message)
    } finally {
      setBusy(false)
    }
  }

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />

  return (
    <Panel title="Two-step sign-in" description="A code from an authenticator app on your phone, as well as your password.">
      {user.twoFactorEnabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <ShieldCheck className="size-4" aria-hidden="true" />
            On. You’ll be asked for a code each time you sign in.
          </p>
          {disabling ? (
            <form onSubmit={disable} className="space-y-3">
              <Field id="disable-proof" label="A code from your app, or your password">
                <Input id="disable-proof" type="password" autoComplete="current-password" value={proof} onChange={(event) => setProof(event.target.value)} />
              </Field>
              <FormError message={error} />
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setDisabling(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" size="sm" disabled={!proof || busy}>
                  Turn off
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDisabling(true)}>
              Turn off, or move to a new phone
            </Button>
          )}
        </div>
      ) : setup ? (
        <form onSubmit={enable} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
            <li>Scan this code, or type the key below.</li>
            <li>Enter the six digits the app shows.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-5">
            <img src={setup.qr} alt="QR code for your authenticator app" width="200" height="200" className="rounded-lg border bg-white p-2" />
            <p className="max-w-[16rem] break-all font-mono text-xs text-muted-foreground">
              Key: <span className="text-foreground">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
            </p>
          </div>
          <Field id="first-code" label="Code from the app">
            <Input
              id="first-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-40 text-center text-lg font-semibold tracking-[0.3em]"
            />
          </Field>
          <FormError message={error} />
          <Button type="submit" disabled={code.length < 6 || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Turn on
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Off. Anyone with your password can sign in as you.</p>
          <FormError message={error} />
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Set up two-step sign-in
          </Button>
        </div>
      )}
    </Panel>
  )
}

function RecoveryCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false)
  return (
    <Panel title="Save your recovery codes" description="If you lose your phone, each of these signs you in once. They won’t be shown again.">
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-muted px-3 py-2 text-center tracking-wider text-foreground">
            {code}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => setCopied(true)).catch(() => {})}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy them'}
        </Button>
        <Button size="sm" onClick={onDone}>
          I’ve saved them
        </Button>
      </div>
    </Panel>
  )
}

const deviceName = (userAgent = '') => {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser'
  const system = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : ''
  return system ? `${browser} on ${system}` : browser
}

function SessionsPanel({ notify }) {
  const [sessions, setSessions] = useState(null)
  const load = useCallback(() => api('/auth/sessions').then(({ sessions: list }) => setSessions(list)), [])
  useEffect(() => {
    load()
  }, [load])

  const revoke = async (body, message) => {
    const { revoked } = await api('/auth/sessions/revoke', { method: 'POST', body })
    notify(message(revoked))
    load()
  }

  return (
    <Panel
      title="Where you’re signed in"
      action={
        sessions && sessions.length > 1 ? (
          <Button variant="outline" size="sm" onClick={() => revoke({ all: true }, (count) => `Signed out ${count} other ${count === 1 ? 'browser' : 'browsers'}`)}>
            <LogOut />
            Sign out everywhere else
          </Button>
        ) : null
      }
      bodyClassName="p-0"
    >
      {!sessions ? (
        <Loader2 className="m-5 size-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : (
        <ul className="divide-y">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-foreground">
                  {deviceName(session.userAgent)}
                  {session.current ? <span className="ml-2 text-xs text-success">This browser</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Active {timeAgo(session.lastSeenAt)}
                  {session.ip ? `, ${session.ip}` : ''}
                </span>
              </span>
              {!session.current ? (
                <Button variant="ghost" size="sm" onClick={() => revoke({ id: session.id }, () => 'Signed out')}>
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
