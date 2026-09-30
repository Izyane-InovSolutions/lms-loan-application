/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react'
import { ImageUp, Loader2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBranding } from '@/components/brand/BrandingProvider'
import { BRAND_NAME_MAX, DEFAULT_BRAND_NAME, LOGO_TYPES } from '@/config/branding'
import { api } from '../api'
import { Field, FormError, Panel } from '../components'

/**
 * Settings → Branding: the product's name and logo, as applicants and staff see them —
 * the site header, sign-in pages, emails, consent wording, generated documents and the
 * authenticator app. Changes show everywhere as soon as they are saved.
 */
export function BrandingTab({ initial, notify }) {
  const branding = useBranding()
  const [name, setName] = useState(initial?.name || DEFAULT_BRAND_NAME)
  const [savedName, setSavedName] = useState(initial?.name || DEFAULT_BRAND_NAME)
  const [busy, setBusy] = useState(null)
  // { panel, message }: shown under the panel whose action failed.
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    setName(initial?.name || DEFAULT_BRAND_NAME)
    setSavedName(initial?.name || DEFAULT_BRAND_NAME)
  }, [initial])

  const run = async (kind, action, message) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
      await branding.refresh()
      notify(message)
    } catch (runError) {
      setError({ panel: kind === 'name' ? 'name' : 'logo', message: runError.message })
    } finally {
      setBusy(null)
    }
  }

  const saveName = () =>
    run(
      'name',
      async () => {
        const response = await api('/settings/branding', { method: 'PUT', body: { name } })
        setName(response.branding.name)
        setSavedName(response.branding.name)
      },
      'Name saved'
    )

  const upload = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    run(
      'upload',
      async () => {
        const form = new FormData()
        form.append('file', file)
        const response = await fetch('/api/v1/admin/branding/logo', { method: 'POST', body: form, credentials: 'same-origin' })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'The upload failed.')
      },
      'Logo updated'
    )
  }

  const useDefaultLogo = () => run('reset', () => api('/admin/branding/logo', { method: 'DELETE' }), 'Back to the default logo')

  const trimmed = name.trim()

  return (
    <div className="space-y-6">
      <Panel title="Name" description="Shown in the site header, sign-in pages, emails, consent wording, the authenticator app and generated offer documents.">
        <Field id="branding-name" label="Product name" hint={`Up to ${BRAND_NAME_MAX} characters. The default is “${DEFAULT_BRAND_NAME}”.`}>
          <Input id="branding-name" maxLength={BRAND_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <p className="mt-3 text-sm text-muted-foreground">
          Offer letters and agreements name the lender as this too, unless LENDER_NAME is set for the deployment.
        </p>
        <FormError message={error?.panel === 'name' ? error.message : ''} />
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button size="sm" onClick={saveName} disabled={busy !== null || trimmed.length < 2 || trimmed === savedName}>
            {busy === 'name' ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </Panel>

      <Panel title="Logo" description="Shown on a white square tile in the header, the sidebar, sign-in pages and the application summary, and used as the browser tab icon.">
        <div className="flex flex-wrap items-center gap-5">
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
            <img src={branding.logoSrc} alt={`Current logo${branding.customLogo ? '' : ' (default)'}`} className="size-full object-contain p-1" />
          </span>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{branding.customLogo ? 'Your uploaded logo.' : 'The default logo.'}</p>
            <p>A square PNG, JPG or WebP image of 1 MB or less works best, at least 256 × 256 pixels.</p>
          </div>
        </div>
        <FormError message={error?.panel === 'logo' ? error.message : ''} />
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {branding.customLogo ? (
            <Button size="sm" variant="outline" onClick={useDefaultLogo} disabled={busy !== null}>
              {busy === 'reset' ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Use the default logo
            </Button>
          ) : null}
          <input ref={fileRef} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" onChange={upload} aria-label="Upload a logo" />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === 'upload' ? <Loader2 className="animate-spin" /> : <ImageUp />}
            Upload a logo
          </Button>
        </div>
      </Panel>
    </div>
  )
}
