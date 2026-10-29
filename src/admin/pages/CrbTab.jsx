import React, { useState } from 'react'
import { AlertTriangle, Check, Loader2, PlugZap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '../api'
import { Field, FormError, Panel } from '../components'
import { SaveBar, SecretField, useSettingGroup } from './SettingsPage'

const PROVIDERS = [
  { value: 'environment', label: 'Server environment (CRB_* variables)' },
  { value: 'none', label: 'No credit bureau' },
  { value: 'demo', label: 'Sample data (demos and training only)' },
  { value: 'product109', label: 'Credit bureau, Product 109' },
]

const KINDS = { demo: 'sample data', product109: 'Product 109' }

/** Where the bureau in use comes from and what it still lacks (describeCrb on the server). */
const statusNote = (crb) => {
  if (!crb?.kind)
    return crb?.source === 'settings'
      ? 'No credit bureau is selected: the “Run credit check” action is hidden.'
      : 'No credit bureau is set up here or on the server: the “Run credit check” action is hidden.'
  const where = crb.source === 'settings' ? 'saved here' : 'from the server environment'
  const name = KINDS[crb.kind.split(' ')[0]] || crb.kind
  return crb.missing?.length ? `Using ${name}, ${where}, but it is missing: ${crb.missing.join(', ')}.` : `Using ${name}, ${where}.`
}

/**
 * Settings → Credit bureau: which bureau the "Run credit check" action asks, and how to
 * reach it. Passwords are stored encrypted and never shown again; "Server environment"
 * keeps following the CRB_* variables (api/_lib/crb/index.js).
 */
export function CrbTab({ settings, integrations, notify, onSaved }) {
  const connection = useSettingGroup('crb', settings.crb, notify)
  const [test, setTest] = useState(null)
  const [testing, setTesting] = useState(false)
  const value = connection.value
  const set = (field) => (event) => connection.set({ [field]: event.target.value })

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await api('/settings/crb/test', { method: 'POST', body: value }))
    } catch (error) {
      setTest({ ok: false, message: error.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <Panel title="Credit bureau" description={statusNote(integrations.crb)}>
        <div className="space-y-5">
          <Field id="crb-provider" label="Bureau" hint="Officers can pull a report only for applicants who consented to a credit check.">
            <Select id="crb-provider" value={value.provider} onChange={set('provider')}>
              {PROVIDERS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </Field>

          {value.provider === 'demo' ? (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Sample data returns made-up scores, labelled as such on every report. Never use it for real lending decisions.
            </p>
          ) : null}

          {value.provider === 'product109' ? (
            <>
              <Field id="crb-wsdl" label="WSDL address" hint="The bureau’s Product 109 service description, over HTTPS.">
                <Input id="crb-wsdl" value={value.wsdlUrl} onChange={set('wsdlUrl')} placeholder="https://bureau.example.co.zm/Product109Service?wsdl" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="crb-transport-username" label="Transport username" hint="Signs in to the bureau’s server.">
                  <Input id="crb-transport-username" autoComplete="off" value={value.transportUsername} onChange={set('transportUsername')} />
                </Field>
                <SecretField
                  id="crb-transport-password"
                  label="Transport password"
                  isSet={value.transportPasswordSet}
                  value={value.transportPassword}
                  onChange={(transportPassword) => connection.set({ transportPassword })}
                />
                <Field id="crb-message-username" label="Message username" hint="Sent inside each enquiry.">
                  <Input id="crb-message-username" autoComplete="off" value={value.messageUsername} onChange={set('messageUsername')} />
                </Field>
                <SecretField
                  id="crb-message-password"
                  label="Message password"
                  isSet={value.messagePasswordSet}
                  value={value.messagePassword}
                  onChange={(messagePassword) => connection.set({ messagePassword })}
                />
                <Field id="crb-code" label="Subscriber code">
                  <Input id="crb-code" value={value.code} onChange={set('code')} />
                </Field>
                <Field id="crb-infinity-code" label="Infinity code">
                  <Input id="crb-infinity-code" value={value.infinityCode} onChange={set('infinityCode')} />
                </Field>
                <Field id="crb-report-reason" label="Report reason" hint="Code from the bureau contract (usually 2).">
                  <Input id="crb-report-reason" type="number" min="1" max="99" value={value.reportReason} onChange={set('reportReason')} />
                </Field>
                <Field id="crb-report-sector" label="Report sector" hint="Code from the bureau contract (usually 2).">
                  <Input id="crb-report-sector" type="number" min="1" max="99" value={value.reportSector} onChange={set('reportSector')} />
                </Field>
                <Field id="crb-timeout" label="Request timeout (seconds)">
                  <Input id="crb-timeout" type="number" min="5" max="120" value={value.timeoutSeconds} onChange={set('timeoutSeconds')} />
                </Field>
              </div>
              <Field
                id="crb-test-identity"
                label="Bureau test identity (testing only)"
                hint="For the bureau’s test account: “NRC|other names|surname” of its test person, sent instead of the applicant and marked on every report. Leave blank in production, where it is refused."
              >
                <Input id="crb-test-identity" value={value.testIdentity} onChange={set('testIdentity')} placeholder="390791/99/9|Othername|Surname" />
              </Field>
              <p className="text-xs text-muted-foreground">A custom certificate authority, if the bureau needs one, is set on the server with CRB_CA_FILE.</p>
            </>
          ) : null}

          {test ? (
            <p role="status" className={cn('flex items-start gap-2 rounded-md p-3 text-sm', test.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
              {test.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              {test.message}
            </p>
          ) : null}
        </div>
        <FormError message={connection.error} />
        <SaveBar dirty={connection.dirty} saving={connection.saving} onSave={async () => (await connection.save()) && onSaved()}>
          <Button variant="outline" size="sm" onClick={runTest} disabled={testing || value.provider === 'none'}>
            {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Test connection
          </Button>
        </SaveBar>
      </Panel>
    </div>
  )
}
