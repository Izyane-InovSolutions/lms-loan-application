import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { WIPE_CATEGORIES, WIPE_PHRASE } from '@/config/dataWipe'
import { api } from '../api'
import { Field, FormError } from '../components'

/*
 * Settings → Danger zone, for administrators only. Wipe data runs in three steps:
 * choose what to delete (with how much there is of each), confirm (type WIPE and
 * your password), then see what was removed. The server checks all of it again
 * (api/_handlers/dataWipe.js).
 */

const plural = (count, word) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

export function DangerZoneTab({ notify }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-xl border border-destructive/40 bg-card" aria-labelledby="danger-zone-title">
      <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/5 px-5 py-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <h2 id="danger-zone-title" className="text-sm font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Actions here can’t be undone. Only administrators see this.</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Wipe data</p>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Permanently delete applications and other records, for example after testing or training. Settings, staff accounts, roles, credit rules, the workflow and document templates are kept.
          </p>
        </div>
        <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
          <Trash2 />
          Wipe data…
        </Button>
      </div>
      <WipeDialog open={open} onOpenChange={setOpen} notify={notify} />
    </section>
  )
}

function WipeDialog({ open, onOpenChange, notify }) {
  const [step, setStep] = useState('choose')
  const [info, setInfo] = useState(null)
  const [chosen, setChosen] = useState([])
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState(null)

  const load = () => {
    setInfo(null)
    setError('')
    api('/admin/wipe')
      .then(setInfo)
      .catch((loadError) => setError(loadError.message))
  }

  useEffect(() => {
    if (!open) return
    setStep('choose')
    setChosen([])
    setPhrase('')
    setPassword('')
    setBusy(false)
    setRemoved(null)
    load()
  }, [open])

  const counts = info?.counts || {}
  const selected = WIPE_CATEGORIES.filter((category) => chosen.includes(category.key))
  const total = selected.reduce((sum, category) => sum + (counts[category.key] || 0), 0)
  const toggle = (key, on) => setChosen((prev) => (on ? [...prev, key] : prev.filter((entry) => entry !== key)))
  const ready = phrase === WIPE_PHRASE && (!info?.needsPassword || password)

  const wipe = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api('/admin/wipe', { method: 'POST', body: { categories: chosen, confirm: phrase, password } })
      setRemoved(result.removed)
      setStep('done')
      notify('Data wiped')
    } catch (wipeError) {
      setError(wipeError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 'done' ? 'Data wiped' : 'Wipe data'}</DialogTitle>
          <DialogDescription>
            {step === 'choose' ? 'Step 1 of 2: choose what to delete.' : step === 'confirm' ? 'Step 2 of 2: check, then confirm.' : 'Finished. A record of this wipe is in the audit log.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'choose' ? (
          <div className="space-y-3">
            {!info && !error ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Counting records…
              </p>
            ) : null}
            {info ? (
              <>
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChosen(chosen.length === WIPE_CATEGORIES.length ? [] : WIPE_CATEGORIES.map((category) => category.key))}>
                    {chosen.length === WIPE_CATEGORIES.length ? 'Clear all' : 'Select all'}
                  </Button>
                </div>
                <ul className="divide-y rounded-lg border">
                  {WIPE_CATEGORIES.map((category) => {
                    const amount = counts[category.key] || 0
                    const picked = chosen.includes(category.key)
                    return (
                      <li key={category.key}>
                        <label className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40', picked && 'bg-destructive/5')}>
                          <input type="checkbox" checked={picked} onChange={(event) => toggle(category.key, event.target.checked)} className="mt-1 size-4 accent-destructive" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span className="text-sm font-medium text-foreground">{category.label}</span>
                              <span className={cn('text-xs tabular-nums', amount ? 'text-foreground' : 'text-muted-foreground')}>{amount ? plural(amount, 'record') : 'None'}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{category.description}</span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {chosen.includes('customers') && !chosen.includes('applications') && counts.applications ? (
                  <p className="text-xs text-muted-foreground">Applications you keep stay on the case list, but their applicants can no longer sign in to follow them.</p>
                ) : null}
                <p className="text-xs text-muted-foreground">Applications already handed to the LMS stay in the LMS; this only deletes them here.</p>
              </>
            ) : null}
          </div>
        ) : null}

        {step === 'confirm' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                This permanently deletes {plural(total, 'record')}. It can’t be undone.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {selected.map((category) => (
                  <li key={category.key} className="flex justify-between gap-3">
                    <span className="text-foreground">{category.label}</span>
                    <span className="tabular-nums text-muted-foreground">{(counts[category.key] || 0).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Field id="wipe-phrase" label={`Type ${WIPE_PHRASE} to confirm`}>
              <Input id="wipe-phrase" autoComplete="off" value={phrase} onChange={(event) => setPhrase(event.target.value.toUpperCase())} />
            </Field>
            {info?.needsPassword ? (
              <Field id="wipe-password" label="Your password">
                <Input id="wipe-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {step === 'done' && removed ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Removed {plural(Object.values(removed).reduce((sum, amount) => sum + amount, 0), 'record')}.
            </p>
            <ul className="divide-y rounded-lg border text-sm">
              {WIPE_CATEGORIES.filter((category) => category.key in removed).map((category) => (
                <li key={category.key} className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-foreground">{category.label}</span>
                  <span className="tabular-nums text-muted-foreground">{removed[category.key].toLocaleString()} deleted</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <FormError message={error} />

        <DialogFooter>
          {step === 'choose' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={!chosen.length || !info} onClick={() => setStep('confirm')}>
                Continue
              </Button>
            </>
          ) : null}
          {step === 'confirm' ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setStep('choose')}>
                Back
              </Button>
              <Button type="button" variant="destructive" disabled={!ready || busy} onClick={wipe}>
                {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {busy ? 'Wiping…' : `Wipe ${plural(total, 'record')}`}
              </Button>
            </>
          ) : null}
          {step === 'done' ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Finish
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
