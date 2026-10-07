/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from 'react'
import { ImageUp, Loader2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBranding } from '@/components/brand/BrandingProvider'
import { BRAND_NAME_MAX, DEFAULT_BRAND_NAME, LOGO_TYPES } from '@/config/branding'
import { api } from '../api'
import { Field, FormError, Panel } from '../components'
import { ThemePanel } from './ThemePanel'

/**
 * Settings → Branding: the theme, name, logo and letterhead, as applicants and staff see
 * them — the workspace, the site, sign-in pages, emails, consent wording, generated
 * documents and the authenticator app. Changes show everywhere as soon as they are saved.
 */
export function BrandingTab({ initial, notify }) {
  const branding = useBranding()
  const [name, setName] = useState(initial?.name || DEFAULT_BRAND_NAME)
  const [savedName, setSavedName] = useState(initial?.name || DEFAULT_BRAND_NAME)
  const [busy, setBusy] = useState(null)
  // { panel, message }: shown under the panel whose action failed.
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const letterheadOf = (source) => Object.fromEntries(LETTERHEAD_FIELDS.map(({ key }) => [key, source?.[key] || '']))
  const [letterhead, setLetterhead] = useState(() => letterheadOf(initial))
  const [savedLetterhead, setSavedLetterhead] = useState(() => letterheadOf(initial))

  useEffect(() => {
    setName(initial?.name || DEFAULT_BRAND_NAME)
    setSavedName(initial?.name || DEFAULT_BRAND_NAME)
    setLetterhead(letterheadOf(initial))
    setSavedLetterhead(letterheadOf(initial))
  }, [initial])

  const run = async (kind, action, message) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
      await branding.refresh()
      notify(message)
    } catch (runError) {
      setError({ panel: kind === 'name' || kind === 'letterhead' ? kind : 'logo', message: runError.message })
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

  const saveLetterhead = () =>
    run(
      'letterhead',
      async () => {
        const response = await api('/settings/branding', { method: 'PUT', body: letterhead })
        setLetterhead(letterheadOf(response.branding))
        setSavedLetterhead(letterheadOf(response.branding))
      },
      'Letterhead saved'
    )
  const letterheadDirty = JSON.stringify(letterhead) !== JSON.stringify(savedLetterhead)

  const upload = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    run(
      'upload',
      async () => {
        const form = new FormData()
        // Documents (PDFs) can't carry WebP, so a WebP logo is stored as PNG.
        form.append('file', file.type === 'image/webp' ? await webpToPng(file) : file)
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
      <ThemePanel initial={initial} notify={notify} />

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
            <p>A square PNG, JPG or WebP image of 1 MB or less works best, at least 256 × 256 pixels. Documents can only carry PNG and JPG logos.</p>
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

      <Panel
        title="Letterhead"
        description="At the top of every offer letter, facility letter and stage document the workspace writes, and at the foot of every email: the logo and name, these details, and bands of the theme’s accent colour. Uploaded PDF templates keep their own letterhead."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {LETTERHEAD_FIELDS.map((field) => (
            <Field key={field.key} id={`letterhead-${field.key}`} label={field.label} hint={field.hint}>
              <Input id={`letterhead-${field.key}`} type={field.type || 'text'} value={letterhead[field.key]} maxLength={field.max} placeholder={field.placeholder} onChange={(event) => setLetterhead((prev) => ({ ...prev, [field.key]: event.target.value }))} />
            </Field>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Preview it from Settings → Documents, on any written template.</p>
        <FormError message={error?.panel === 'letterhead' ? error.message : ''} />
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button size="sm" onClick={saveLetterhead} disabled={busy !== null || !letterheadDirty}>
            {busy === 'letterhead' ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </Panel>
    </div>
  )
}

/** A WebP image redrawn as a PNG file of the same size, in the browser. */
const webpToPng = async (file) => {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('The logo couldn’t be converted. Upload a PNG or JPG.'))), 'image/png'))
  return new File([blob], file.name.replace(/\.webp$/i, '') + '.png', { type: 'image/png' })
}

const LETTERHEAD_FIELDS = [
  { key: 'address', label: 'Address', placeholder: 'Plot 123, Cairo Road, Lusaka', max: 200, hint: 'One line.' },
  { key: 'phone', label: 'Phone', placeholder: '+260 211 000 000', max: 40 },
  { key: 'email', label: 'Email', type: 'email', placeholder: 'loans@example.com', max: 120 },
  { key: 'website', label: 'Website', placeholder: 'www.example.com', max: 120 },
]
