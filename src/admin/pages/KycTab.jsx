import React, { useState } from 'react'
import { Check, Loader2, Plus, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { AUTH_TYPES, CONTACT_TARGETS, FORM_TARGETS, KYC_ID_TYPES, KYC_PRESETS, LOOKUP_LIMIT_RANGE, OTHER_CONTACT_POLICIES, TIDY_UPS } from '@/config/kyc'
import { api } from '../api'
import { Field, FormError, Panel } from '../components'
import { SaveBar, SecretField, Toggle, useSettingGroup } from './SettingsPage'

const FORMS = { personal: 'Personal records (NRC, passport)', business: 'Business records (TPIN)' }

const targetLabel = (form, field) => FORM_TARGETS[form]?.[field]?.label || CONTACT_TARGETS[field] || field

/**
 * Settings → Customer records: the institution's own platform (core banking, a KYC hub or
 * anything else answering JSON over HTTP), to fill application forms from the customer's
 * record (src/config/kyc.js, api/_lib/kyc/client.js). Secrets are stored encrypted.
 */
export function KycTab({ settings, notify }) {
  const group = useSettingGroup('kyc', settings.kyc, notify)
  const value = group.value
  const set = (changes) => group.set(changes)
  const field = (key) => (event) => set({ [key]: event.target.value })
  const setLookup = (type, changes) => set({ lookups: { ...value.lookups, [type]: { ...value.lookups[type], ...changes } } })
  const setMapping = (form, rows) => set({ mappings: { ...value.mappings, [form]: rows } })
  const [form, setForm] = useState('personal')

  const applyPreset = (key) => {
    const preset = KYC_PRESETS[key]
    if (!preset) return set({ preset: 'custom' })
    set({ preset: key, ...structuredClone(preset.settings) })
  }

  const mappingRows = value.mappings?.[form] || []
  const allTargets = { ...FORM_TARGETS[form], ...Object.fromEntries(Object.entries(CONTACT_TARGETS).map(([key, label]) => [key, { label }])) }

  return (
    <div className="max-w-4xl space-y-6">
      <Panel
        title="Customer records"
        description="Look customers up on your own platform (core banking, a KYC hub or any other) when they start an application, and fill the form from their record. Applicants confirm a code sent to the contact on their record first; agents’ lookups fill the form at once. Documents are always uploaded by hand."
      >
        <div className="space-y-5">
          <Toggle id="kyc-enabled" label="Look customers up" description="Off: the application form starts empty, as before." checked={Boolean(value.enabled)} onChange={(enabled) => set({ enabled })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="kyc-preset" label="Preset" hint="Fills in the lookups, the answer and the field mapping. You can change anything after.">
              <Select id="kyc-preset" value={value.preset || 'custom'} onChange={(event) => applyPreset(event.target.value)}>
                <option value="custom">Custom</option>
                {Object.entries(KYC_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="kyc-timeout" label="Timeout (seconds)">
              <Input id="kyc-timeout" type="number" min="1" max="60" value={value.timeoutSeconds} onChange={field('timeoutSeconds')} />
            </Field>
          </div>
          <Field id="kyc-base" label="Base URL" hint="Where your platform answers, e.g. https://kyc.example.com. https is required.">
            <Input id="kyc-base" value={value.baseUrl} onChange={field('baseUrl')} placeholder="https://" />
          </Field>
        </div>
      </Panel>

      <Panel title="Sign-in" description="How this system proves itself to your platform.">
        <div className="space-y-4">
          <Field id="kyc-auth" label="Method">
            <Select id="kyc-auth" value={value.authType} onChange={field('authType')}>
              {Object.entries(AUTH_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {value.authType === 'apiKey' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="kyc-key-header" label="Header name">
                <Input id="kyc-key-header" value={value.apiKeyHeader} onChange={field('apiKeyHeader')} />
              </Field>
              <SecretField id="kyc-key" label="API key" isSet={value.apiKeySet} value={value.apiKey} onChange={(apiKey) => set({ apiKey })} />
            </div>
          ) : null}
          {value.authType === 'bearer' ? <SecretField id="kyc-bearer" label="Token" isSet={value.bearerTokenSet} value={value.bearerToken} onChange={(bearerToken) => set({ bearerToken })} /> : null}
          {value.authType === 'basic' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="kyc-username" label="Username">
                <Input id="kyc-username" value={value.username} onChange={field('username')} autoComplete="off" />
              </Field>
              <SecretField id="kyc-password" label="Password" isSet={value.passwordSet} value={value.password} onChange={(password) => set({ password })} />
            </div>
          ) : null}
          {value.authType === 'oauth' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="kyc-token-url" label="Token URL">
                <Input id="kyc-token-url" value={value.tokenUrl} onChange={field('tokenUrl')} placeholder="https://" />
              </Field>
              <Field id="kyc-scope" label="Scope (optional)">
                <Input id="kyc-scope" value={value.scope} onChange={field('scope')} />
              </Field>
              <Field id="kyc-client-id" label="Client ID">
                <Input id="kyc-client-id" value={value.clientId} onChange={field('clientId')} autoComplete="off" />
              </Field>
              <SecretField id="kyc-client-secret" label="Client secret" isSet={value.clientSecretSet} value={value.clientSecret} onChange={(clientSecret) => set({ clientSecret })} />
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Extra headers</p>
            {(value.headers || []).map((header, index) => (
              <div key={index} className="flex gap-2">
                <Input aria-label="Header name" value={header.name} placeholder="X-Institution" onChange={(event) => set({ headers: value.headers.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} />
                <Input aria-label="Header value" value={header.value} onChange={(event) => set({ headers: value.headers.map((entry, at) => (at === index ? { ...entry, value: event.target.value } : entry)) })} />
                <Button variant="ghost" size="icon" aria-label="Remove header" onClick={() => set({ headers: value.headers.filter((_, at) => at !== index) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set({ headers: [...(value.headers || []), { name: '', value: '' }] })}>
              <Plus />
              Add a header
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Lookups" description="One request per kind of ID. Put {id} where the number goes; it is sent URL-encoded (or as-is in a POST body).">
        <div className="space-y-4">
          {Object.entries(KYC_ID_TYPES).map(([type, info]) => {
            const lookup = value.lookups?.[type] || {}
            return (
              <div key={type} className="rounded-md border p-3">
                <Toggle id={`kyc-lookup-${type}`} label={`By ${info.label}`} description={info.form === 'business' ? 'Fills the business form.' : 'Fills the personal form.'} checked={Boolean(lookup.enabled)} onChange={(enabled) => setLookup(type, { enabled })} />
                {lookup.enabled ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[7rem_1fr]">
                    <Select aria-label={`${info.label} method`} value={lookup.method || 'GET'} onChange={(event) => setLookup(type, { method: event.target.value })}>
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </Select>
                    <Input aria-label={`${info.label} path`} value={lookup.path || ''} onChange={(event) => setLookup(type, { path: event.target.value })} placeholder="/customers/lookup?id_number={id}" />
                    {lookup.method === 'POST' ? (
                      <textarea
                        aria-label={`${info.label} body`}
                        rows={3}
                        value={lookup.body || ''}
                        onChange={(event) => setLookup(type, { body: event.target.value })}
                        placeholder={'{"id_number": "{id}"}'}
                        className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs sm:col-span-2"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Reading the answer" description="A 404 always means not found. Otherwise, the answer counts as found when the value at this path is the one given (leave blank to accept any 2xx).">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="kyc-found-path" label="Found when this path…">
            <Input id="kyc-found-path" value={value.foundPath} onChange={field('foundPath')} placeholder="status" />
          </Field>
          <Field id="kyc-found-value" label="…equals">
            <Input id="kyc-found-value" value={value.foundValue} onChange={field('foundValue')} placeholder="success" />
          </Field>
          <Field id="kyc-record-path" label="The record is at" hint="Blank: the whole answer.">
            <Input id="kyc-record-path" value={value.recordPath} onChange={field('recordPath')} placeholder="data" />
          </Field>
        </div>
      </Panel>

      <Panel title="Field mapping" description="Which value on the record fills which field on the form. Paths use dots, with numbers for list items (profession.0). Mark the mobile and email on record: confirmation codes go to them.">
        <nav aria-label="Record kind" className="mb-4 flex gap-1 border-b">
          {Object.entries(FORMS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setForm(key)}
              aria-current={form === key ? 'page' : undefined}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', form === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="space-y-2">
          {mappingRows.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
              <Select aria-label="Form field" value={row.field} onChange={(event) => setMapping(form, mappingRows.map((entry, at) => (at === index ? { ...entry, field: event.target.value } : entry)))}>
                <option value="">Choose a field…</option>
                {Object.entries(allTargets).map(([key, target]) => (
                  <option key={key} value={key}>
                    {target.label}
                  </option>
                ))}
              </Select>
              <Input aria-label="Path on the record" value={row.path} placeholder="first_name" onChange={(event) => setMapping(form, mappingRows.map((entry, at) => (at === index ? { ...entry, path: event.target.value } : entry)))} />
              <Select aria-label="Tidy-up" value={row.tidy || 'none'} onChange={(event) => setMapping(form, mappingRows.map((entry, at) => (at === index ? { ...entry, tidy: event.target.value } : entry)))}>
                {Object.entries(TIDY_UPS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button variant="ghost" size="icon" aria-label={`Remove ${targetLabel(form, row.field)}`} onClick={() => setMapping(form, mappingRows.filter((_, at) => at !== index))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {!mappingRows.length ? <p className="text-sm text-muted-foreground">Nothing mapped yet: these records fill nothing.</p> : null}
          <Button variant="outline" size="sm" onClick={() => setMapping(form, [...mappingRows, { field: '', path: '', tidy: 'none' }])}>
            <Plus />
            Add a field
          </Button>
        </div>
      </Panel>

      <Panel
        title="Lookup limits"
        description="How often the start screen’s lookup may be used in an hour, against anyone trying ID numbers to find out who banks with you. Raise them while testing. Agents’ lookups aren’t limited; they’re signed in and each is in the audit log."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="kyc-limit-id" label="Lookups of one ID, per hour" hint={`${LOOKUP_LIMIT_RANGE.min} to ${LOOKUP_LIMIT_RANGE.max}. Default 5.`}>
            <Input
              id="kyc-limit-id"
              type="number"
              min={LOOKUP_LIMIT_RANGE.min}
              max={LOOKUP_LIMIT_RANGE.max}
              value={value.limits?.perIdPerHour ?? 5}
              onChange={(event) => set({ limits: { ...value.limits, perIdPerHour: event.target.value } })}
            />
          </Field>
          <Field id="kyc-limit-ip" label="Lookups from one network, per hour" hint={`${LOOKUP_LIMIT_RANGE.min} to ${LOOKUP_LIMIT_RANGE.max}. Default 20. A branch or office shares one address.`}>
            <Input
              id="kyc-limit-ip"
              type="number"
              min={LOOKUP_LIMIT_RANGE.min}
              max={LOOKUP_LIMIT_RANGE.max}
              value={value.limits?.perIpPerHour ?? 20}
              onChange={(event) => set({ limits: { ...value.limits, perIpPerHour: event.target.value } })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="When the applicant uses a different contact" description="An applicant may not have the mobile or email on their record any more. Staff see on the case which they used.">
        <fieldset className="space-y-2">
          <legend className="sr-only">What happens</legend>
          {Object.entries(OTHER_CONTACT_POLICIES).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input type="radio" name="kyc-other" className="mt-1 accent-[hsl(var(--primary))]" checked={value.otherContact?.policy === key} onChange={() => set({ otherContact: { policy: key, fields: value.otherContact?.fields || [] } })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {value.otherContact?.policy === 'fields' ? (
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {Object.entries(FORM_TARGETS).flatMap(([formKey, targets]) =>
              Object.entries(targets).map(([key, target]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-[hsl(var(--primary))]"
                    checked={value.otherContact.fields.includes(key)}
                    onChange={(event) =>
                      set({ otherContact: { ...value.otherContact, fields: event.target.checked ? [...value.otherContact.fields, key] : value.otherContact.fields.filter((entry) => entry !== key) } })
                    }
                  />
                  {target.label}
                  <span className="text-xs text-muted-foreground">({formKey})</span>
                </label>
              ))
            )}
          </div>
        ) : null}
        <FormError message={group.error} />
        <SaveBar dirty={group.dirty} saving={group.saving} onSave={() => group.save()} />
      </Panel>

      <TestLookup form={value} />
    </div>
  )
}

/** One ID against the settings on screen (saved or not): the raw answer, and what it would fill. */
function TestLookup({ form }) {
  const [idType, setIdType] = useState('nrc')
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async (event) => {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      setResult(await api('/settings/kyc/test', { method: 'POST', body: { idType, id, form } }))
    } catch (error) {
      setResult({ status: 'error', error: error.message })
    } finally {
      setBusy(false)
    }
  }

  const formKey = KYC_ID_TYPES[idType].form
  return (
    <Panel title="Test lookup" description="Uses the settings above, saved or not. Nothing is stored; the test is in the audit log.">
      <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
        <Select aria-label="ID type" value={idType} onChange={(event) => setIdType(event.target.value)} className="sm:w-40">
          {Object.entries(KYC_ID_TYPES).map(([key, info]) => (
            <option key={key} value={key}>
              {info.label}
            </option>
          ))}
        </Select>
        <Input aria-label="ID number" value={id} onChange={(event) => setId(event.target.value)} placeholder="123456/78/9" />
        <Button type="submit" disabled={busy || !id.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          Look up
        </Button>
      </form>
      {result ? (
        <div className="mt-4 space-y-3 text-sm">
          <p role="status" className={cn('font-medium', result.status === 'found' ? 'text-success' : result.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {result.status === 'found' ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-4" aria-hidden="true" />
                Found
              </span>
            ) : result.status === 'not_found' ? (
              'Not found'
            ) : (
              result.error || 'Error'
            )}
            {result.httpStatus ? <span className="ml-2 font-normal text-muted-foreground">HTTP {result.httpStatus}, {result.ms} ms</span> : null}
          </p>
          {result.status === 'found' ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Would fill</th>
                    <th className="px-3 py-2 font-medium">With</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(result.values || {}).map(([key, entry]) => (
                    <tr key={key}>
                      <td className="px-3 py-1.5">{targetLabel(formKey, key)}</td>
                      <td className="px-3 py-1.5 text-foreground">{entry}</td>
                    </tr>
                  ))}
                  {Object.entries(result.contacts || {}).map(([key, entry]) => (
                    <tr key={key}>
                      <td className="px-3 py-1.5">{key === 'mobile' ? 'Code by text to' : 'Code by email to'}</td>
                      <td className="px-3 py-1.5 text-foreground">{entry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.raw ? (
            <details>
              <summary className="cursor-pointer text-muted-foreground">The platform’s answer</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(result.raw, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
