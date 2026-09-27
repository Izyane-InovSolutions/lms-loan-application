import React, { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SimpleText } from '@/lib/simpleText'

/*
 * The terms and privacy notice the applicant accepts on submit. The text is what
 * administrators publish in Settings → Terms and privacy; the server records which
 * versions were in force when the application was filed.
 */

const fetchDocument = (kind) =>
  fetch(`/api/v1/legal/${kind}`).then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))

function TermsModal({ open, onClose, onAccept }) {
  const [accepted, setAccepted] = useState(false)
  const [documents, setDocuments] = useState({ status: 'loading' })
  const [tab, setTab] = useState('terms')

  useEffect(() => {
    if (!open) {
      setAccepted(false)
      return undefined
    }
    let cancelled = false
    setDocuments({ status: 'loading' })
    Promise.all([fetchDocument('terms'), fetchDocument('privacy')])
      .then(([terms, privacy]) => !cancelled && setDocuments({ status: 'ready', terms, privacy }))
      .catch(() => !cancelled && setDocuments({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const current = documents.status === 'ready' ? documents[tab] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border bg-card text-card-foreground shadow-lift">
        <div className="flex items-start justify-between gap-4 border-b px-6 pb-4 pt-5">
          <div>
            <h2 id="terms-title" className="text-xl font-semibold tracking-tight">
              Before you submit
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Read the terms and how we use your information, then accept to send your application.</p>
          </div>
          <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose} aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-1 px-6 pt-3" role="tablist">
          {[
            ['terms', documents.terms?.title || 'Terms and conditions'],
            ['privacy', documents.privacy?.title || 'Privacy notice'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm leading-relaxed text-muted-foreground">
          {documents.status === 'loading' ? (
            <p className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          ) : documents.status === 'error' ? (
            <p className="text-destructive">We couldn’t load the terms. Check your connection and try again.</p>
          ) : (
            <SimpleText text={current.body} />
          )}
        </div>

        <div className="border-t px-6 py-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              disabled={documents.status !== 'ready'}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
            />
            <span>I have read and accept the terms and conditions, and I understand how my information will be used.</span>
          </label>
          <Button type="button" className="mt-4 w-full" disabled={!accepted || documents.status !== 'ready'} onClick={() => onAccept()}>
            Accept and submit
          </Button>
        </div>
      </div>
    </div>
  )
}

export default TermsModal
