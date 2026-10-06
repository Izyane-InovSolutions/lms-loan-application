import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, AlertTriangle, ArchiveRestore, Check, ExternalLink, FileUp, Loader2, Plus, Rocket, Save, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { documentKindKey } from '@/config/templates'
import { api } from '../api'
import { Field, FormError, Panel, dateTime } from '../components'

/**
 * Settings → Documents: the offer letter and facility letter every approved loan gets, and
 * the lender's own documents (a debit order mandate, a guarantee form), which the workflow
 * sends at the stages that list them. Each is either written here with {{fields}}, or the
 * lender's own PDF uploaded. A draft is previewed with sample values, then published;
 * customers only ever get a published one.
 */
export function DocumentTemplatesTab({ notify }) {
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(() => {
    api('/admin/templates')
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading documents…
      </p>
    )
  }
  if (state.status === 'error') return <FormError message={state.message} />

  const describeKind = (kind) =>
    kind.builtIn
      ? kind
      : {
          ...kind,
          description: `${kind.description ? `${kind.description} ` : ''}${
            kind.requiresSignature ? 'The applicant signs it online, or prints, signs and uploads it.' : 'Sent for the applicant to read and keep.'
          } Sent at the workflow stages that list it.`,
        }

  return (
    <div className="space-y-6">
      <DocumentKinds custom={state.custom} notify={notify} onChanged={load} />
      {state.kindList
        .filter((kind) => !kind.retired)
        .map((kind) => (
          <TemplateEditor key={kind.key} kind={kind.key} meta={describeKind(kind)} entry={state.kinds[kind.key]} fields={state.fields} signatureField={state.signatureField} notify={notify} onChanged={load} />
        ))}
    </div>
  )
}

/**
 * The lender's own document kinds: add one, say whether the applicant signs it, retire it
 * once no workflow stage sends it. The whole list is saved as the `documents` setting.
 */
function DocumentKinds({ custom, notify, onChanged }) {
  const [label, setLabel] = useState('')
  const [requiresSignature, setRequiresSignature] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const save = async (key, kinds, message) => {
    setBusy(key)
    setError('')
    try {
      await api('/settings/documents', { method: 'PUT', body: { kinds } })
      notify(message)
      onChanged()
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  const change = (kind, changes, message) => save(kind.key, custom.map((entry) => (entry.key === kind.key ? { ...entry, ...changes } : entry)), message)

  const add = async (event) => {
    event.preventDefault()
    const name = label.trim()
    if (await save('add', [...custom, { key: documentKindKey(name), label: name, requiresSignature }], `${name} added. Write its wording below, then add it to a workflow stage.`)) {
      setLabel('')
      setRequiresSignature(true)
    }
  }

  return (
    <Panel title="Your own documents" description="Documents besides the offer letter and facility letter, such as a debit order mandate or a guarantee form. Choose which workflow stage sends each one in Workflow.">
      <div className="space-y-4">
        {custom.length ? (
          <ul className="divide-y rounded-lg border">
            {custom.map((kind) => (
              <li key={kind.key} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm', kind.retired && 'text-muted-foreground')}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{kind.label}</span>
                  {kind.retired ? <span className="block text-xs">Retired: no longer sent. Documents already sent keep its name.</span> : null}
                </span>
                {!kind.retired ? (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={Boolean(kind.requiresSignature)}
                      disabled={Boolean(busy)}
                      onChange={(event) => change(kind, { requiresSignature: event.target.checked }, event.target.checked ? `${kind.label} needs a signature` : `${kind.label} no longer needs a signature`)}
                    />
                    Needs the applicant’s signature
                  </label>
                ) : null}
                <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => change(kind, { retired: !kind.retired }, kind.retired ? `${kind.label} brought back` : `${kind.label} retired`)}>
                  {busy === kind.key ? <Loader2 className="animate-spin" /> : kind.retired ? <ArchiveRestore /> : <Archive />}
                  {kind.retired ? 'Bring back' : 'Retire'}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <Field id="new-document" label="Add a document">
            <Input id="new-document" value={label} maxLength={80} placeholder="e.g. Debit order mandate" onChange={(event) => setLabel(event.target.value)} className="w-72" />
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={requiresSignature} onChange={(event) => setRequiresSignature(event.target.checked)} />
            Needs the applicant’s signature
          </label>
          <Button type="submit" variant="outline" disabled={label.trim().length < 2 || Boolean(busy)}>
            {busy === 'add' ? <Loader2 className="animate-spin" /> : <Plus />}
            Add
          </Button>
        </form>
        <FormError message={error} />
      </div>
    </Panel>
  )
}

function TemplateEditor({ kind, meta, entry, fields, signatureField, notify, onChanged }) {
  const { published, draft, history } = entry
  const base = draft || published
  const [mode, setMode] = useState(base.source === 'pdf' ? 'pdf' : 'text')
  const [title, setTitle] = useState(base.source === 'text' ? base.title : meta.label)
  const [body, setBody] = useState(base.source === 'text' ? base.body : '')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const bodyRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    const next = entry.draft || entry.published
    setMode(next.source === 'pdf' ? 'pdf' : 'text')
    if (next.source === 'text') {
      setTitle(next.title)
      setBody(next.body)
    }
  }, [entry])

  // Compared with the written version being edited: the draft if there is one, else what is published.
  const editing = draft?.source === 'text' ? draft : !draft && published.source === 'text' ? published : null
  const textDirty = mode === 'text' && (!editing || title !== editing.title || body !== editing.body)

  const run = async (key, task, message) => {
    setBusy(key)
    setError('')
    try {
      await task()
      if (message) notify(message)
      onChanged()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setBusy(null)
    }
  }

  const saveText = () => run('save', () => api(`/admin/templates/${kind}/draft`, { method: 'PUT', body: { title, body } }), 'Draft saved')
  const publish = () => run('publish', () => api(`/admin/templates/${kind}/publish`, { method: 'POST' }), `${meta.label} published`)
  const discard = () => run('discard', () => api(`/admin/templates/${kind}/draft`, { method: 'DELETE' }), 'Draft discarded')

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run(
      'upload',
      async () => {
        const form = new FormData()
        form.append('title', meta.label)
        form.append('file', file)
        const response = await fetch(`/api/v1/admin/templates/${kind}/upload`, { method: 'POST', body: form, credentials: 'same-origin' })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'The upload failed.')
      },
      'PDF uploaded as a draft'
    )
  }

  /** Puts {{field}} where the cursor is in the wording. */
  const insertField = (key) => {
    const area = bodyRef.current
    const token = `{{${key}}}`
    if (!area) return setBody((value) => `${value}${token}`)
    const { selectionStart, selectionEnd } = area
    const next = `${body.slice(0, selectionStart)}${token}${body.slice(selectionEnd)}`
    setBody(next)
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(selectionStart + token.length, selectionStart + token.length)
    })
  }

  const previewUrl = (version) => `/api/v1/admin/templates/${kind}/preview${version === 'draft' ? '?version=draft' : ''}`

  return (
    <Panel
      title={meta.label}
      description={meta.description}
      action={
        <a href={previewUrl('published')} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
          What customers get now
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-muted-foreground">
            Published: version {published.version}, {published.source === 'pdf' ? `uploaded PDF (${published.pdfFilename})` : 'written here'}
            {published.publishedAt ? `, ${dateTime(published.publishedAt)}` : ''}
          </span>
          {published.placeholder ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Starting wording: replace it with your approved text
            </span>
          ) : null}
          {draft ? <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Unpublished draft</span> : null}
        </div>

        <div className="flex gap-1 rounded-lg border bg-muted/40 p-0.5 text-sm sm:w-fit" role="radiogroup" aria-label={`How the ${meta.label.toLowerCase()} is made`}>
          {[
            ['text', 'Write it here'],
            ['pdf', 'Upload a PDF'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn('flex-1 rounded-md px-3 py-1.5 font-medium transition-colors', mode === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'text' ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4">
              <Field id={`${kind}-title`} label="Title">
                <Input id={`${kind}-title`} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <Field
                id={`${kind}-body`}
                label="Wording"
                hint={`Each line prints as typed; a blank line starts a new paragraph. “## ” makes a heading and “- ” a bullet.${meta.requiresSignature !== false ? ` A line holding only {{${signatureField}}} is where the customer signs.` : ''}`}
              >
                <textarea
                  id={`${kind}-body`}
                  ref={bodyRef}
                  rows={18}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
              {draft?.source === 'text' && draft.unknownPlaceholders?.length ? (
                <p className="flex items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Not fields we know, so they print as typed: {draft.unknownPlaceholders.map((key) => `{{${key}}}`).join(', ')}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Fields</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Click to insert at the cursor. Each is filled from the case.</p>
              <ul className="mt-2 max-h-[26rem] space-y-1 overflow-y-auto pr-1">
                {fields.map((field) => (
                  <li key={field.key}>
                    <button type="button" onClick={() => insertField(field.key)} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted" title={`e.g. ${field.sample}`}>
                      <span className="block font-mono text-foreground">{`{{${field.key}}}`}</span>
                      <span className="block text-muted-foreground">{field.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p>
                Use your own PDF. If it has fillable form fields, name them after the fields (for example <span className="font-mono text-foreground">customer_name</span> or{' '}
                <span className="font-mono text-foreground">{'{{amount}}'}</span>) and they are filled in for each loan.
                {meta.requiresSignature !== false ? (
                  <>
                    {' '}Add a field called <span className="font-mono text-foreground">{signatureField}</span> where the customer’s signature should appear.
                  </>
                ) : null}
              </p>
              <p className="mt-2">A PDF without fields is used as it is, with a page of the loan’s terms added at the end. Every signed copy also gets a signature record page.</p>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={upload} aria-label={`Upload a PDF ${meta.label.toLowerCase()}`} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
              {busy === 'upload' ? <Loader2 className="animate-spin" /> : <FileUp />}
              {draft?.source === 'pdf' ? 'Upload a different PDF' : 'Upload a PDF'}
            </Button>
            {draft?.source === 'pdf' ? <UploadedFields draft={draft} signatureField={signatureField} /> : null}
          </div>
        )}

        <FormError message={error} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <>
                <Button variant="ghost" size="sm" onClick={discard} disabled={Boolean(busy)}>
                  {busy === 'discard' ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Discard draft
                </Button>
                <a href={previewUrl('draft')} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Preview the draft
                </a>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === 'text' ? (
              <Button variant="outline" size="sm" onClick={saveText} disabled={!textDirty || Boolean(busy) || title.trim().length < 2}>
                {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
                Save draft
              </Button>
            ) : null}
            <Button size="sm" onClick={publish} disabled={!draft || Boolean(busy)}>
              {busy === 'publish' ? <Loader2 className="animate-spin" /> : <Rocket />}
              Publish
            </Button>
          </div>
        </div>

        {history.length > 1 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Earlier versions</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {history.map((version) => (
                <li key={version.id}>
                  Version {version.version}, {version.source === 'pdf' ? 'uploaded PDF' : 'written here'}, {version.status === 'published' ? 'in use' : 'retired'}
                  {version.publishedAt ? `, published ${dateTime(version.publishedAt)}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Every generated document records the version it came from.</p>
          </details>
        ) : null}
      </div>
    </Panel>
  )
}

function UploadedFields({ draft, signatureField }) {
  const filled = draft.recognisedFields.filter((name) => name.toLowerCase().replace(/[{}\s]/g, '') !== signatureField)
  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm">
      <p className="font-medium text-foreground">{draft.pdfFilename}</p>
      {filled.length ? (
        <p className="flex items-start gap-2 text-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          Filled for each loan: {filled.join(', ')}
        </p>
      ) : (
        <p className="text-muted-foreground">No fields we recognise, so a page with the loan’s terms is added at the end.</p>
      )}
      {draft.otherFields.length ? <p className="text-muted-foreground">Left blank: {draft.otherFields.join(', ')}</p> : null}
      <p className="text-muted-foreground">
        {draft.hasSignatureField ? 'The signature is drawn in its field, and a signature record page is added.' : 'The signature goes on a signature record page added at the end.'}
      </p>
    </div>
  )
}
