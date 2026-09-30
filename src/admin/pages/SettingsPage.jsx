import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Database, Loader2, PlugZap, Plus, Rocket, Send, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SimpleText } from '@/lib/simpleText'
import { PERMISSION_GROUPS, registeredRoles, roleLabel } from '@/config/roles'
import { APPLICATION_STATUSES } from '@/config/applications'
import { RENAMABLE_STATUSES, STAGE_PHASES } from '@/config/stages'
import { describeFee, describeInterest, formatKwacha, priceLoan } from '@/config/loanProducts'
import { AI_CONNECTIONS, AI_FIELDS, AI_MODEL_PROVIDERS, OCR_ENGINES, isServiceReady } from '@/config/aiProviders'
import { api } from '../api'
import { useAuth } from '../auth'
import { Field, FormError, PageHeader, Panel, dateTime, useToast } from '../components'
import { DocumentTemplatesTab } from './DocumentTemplatesTab'
import { BrandingTab } from './BrandingTab'

const TABS = [
  { id: 'workflow', label: 'Credit workflow' },
  { id: 'stages', label: 'Stages' },
  { id: 'products', label: 'Loan products' },
  { id: 'lms', label: 'LMS connection' },
  { id: 'notifications', label: 'Notifications and SMS' },
  { id: 'ai', label: 'AI document checks' },
  { id: 'retention', label: 'Data retention' },
  { id: 'security', label: 'Security' },
  { id: 'branding', label: 'Branding' },
  { id: 'documents', label: 'Offer documents' },
  { id: 'legal', label: 'Terms and privacy' },
  { id: 'demo', label: 'Sample data', demoOnly: true },
]

function Toggle({ id, label, description, checked, onChange, disabled }) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start justify-between gap-6', disabled && 'cursor-not-allowed opacity-60')}>
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
        <span className="block h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

function SaveBar({ dirty, saving, onSave, children }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
      <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </div>
  )
}

/** One settings key: edited locally, saved whole, with the server's validation message on failure. */
function useSettingGroup(key, initial, notify) {
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setValue(initial)
    setSaved(initial)
  }, [initial])
  const save = async (override) => {
    setSaving(true)
    setError('')
    try {
      const response = await api(`/settings/${key}`, { method: 'PUT', body: override || value })
      setSaved(response[key])
      setValue(response[key])
      notify('Settings saved')
      return response[key]
    } catch (saveError) {
      setError(saveError.message)
      return null
    } finally {
      setSaving(false)
    }
  }
  return { value, set: (changes) => setValue((prev) => ({ ...prev, ...changes })), dirty: JSON.stringify(value) !== JSON.stringify(saved), saving, error, save }
}

export function SettingsPage() {
  const notify = useToast()
  const { demoEnabled } = useAuth()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState({ status: 'loading' })
  const tab = params.get('tab') || 'workflow'

  const load = useCallback(() => {
    api('/settings')
      .then((data) => setState({ status: 'ready', ...data }))
      .catch((error) => setState({ status: 'error', message: error.message }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const tabs = TABS.filter((entry) => !entry.demoOnly || demoEnabled)

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="How the workspace runs. Every change is recorded in the audit log." />
      <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setParams({ tab: entry.id }, { replace: true })}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === entry.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {entry.label}
            {entry.id === 'legal' && state.legalPlaceholders && (state.legalPlaceholders.terms || state.legalPlaceholders.privacy) ? (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" aria-label="needs attention" />
            ) : null}
          </button>
        ))}
      </nav>

      {state.status === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading settings…
        </p>
      ) : state.status === 'error' ? (
        <FormError message={state.message} />
      ) : (
        <>
          {tab === 'workflow' ? <WorkflowTab settings={state.settings} notify={notify} /> : null}
          {tab === 'stages' ? <StagesTab initial={state.settings.stages} notify={notify} /> : null}
          {tab === 'products' ? <ProductsTab initial={state.settings.products} notify={notify} /> : null}
          {tab === 'lms' ? <LmsTab settings={state.settings} integrations={state.integrations} notify={notify} onSaved={load} /> : null}
          {tab === 'notifications' ? <NotificationsTab settings={state.settings} integrations={state.integrations} notify={notify} /> : null}
          {tab === 'ai' ? <AiTab settings={state.settings} integrations={state.integrations} notify={notify} onSaved={load} /> : null}
          {tab === 'retention' ? <RetentionTab initial={state.settings.retention} notify={notify} /> : null}
          {tab === 'security' ? <SecurityTab initial={state.settings.security} notify={notify} /> : null}
          {tab === 'branding' ? <BrandingTab initial={state.settings.branding} notify={notify} /> : null}
          {tab === 'documents' ? <DocumentTemplatesTab notify={notify} /> : null}
          {tab === 'legal' ? <LegalTab notify={notify} onPublished={load} /> : null}
          {tab === 'demo' && demoEnabled ? <SampleData notify={notify} /> : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function WorkflowTab({ settings, notify }) {
  const workflow = useSettingGroup('workflow', settings.workflow, notify)
  const offers = useSettingGroup('offers', settings.offers, notify)
  const prescreen = useSettingGroup('prescreen', settings.prescreen, notify)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Credit decisions">
        <div className="space-y-5">
          <Toggle
            id="four-eyes"
            label="Require a second approver"
            description="Whoever recommends a decision, or brought the customer in, cannot make it. Recommended."
            checked={workflow.value.requireSecondApproval}
            onChange={(requireSecondApproval) => workflow.set({ requireSecondApproval })}
          />
          <Field id="sla-days" label="Target days to a decision" hint="Open cases older than this are flagged, and officers get a daily reminder.">
            <Input id="sla-days" type="number" min="1" max="60" value={workflow.value.slaDays} onChange={(event) => workflow.set({ slaDays: event.target.value })} />
          </Field>
          <p className="text-sm text-muted-foreground">
            How much each person may approve is now set per user on the{' '}
            <Link to="/admin/users" className="text-primary hover:underline">
              Team
            </Link>{' '}
            page, as a minimum and maximum on their profile.
          </p>
        </div>
        <FormError message={workflow.error} />
        <SaveBar dirty={workflow.dirty} saving={workflow.saving} onSave={() => workflow.save()} />
      </Panel>
      <div className="space-y-6">
        <Panel title="Offers">
          <div className="space-y-5">
            <Toggle
              id="require-acceptance"
              label="The customer accepts the offer first"
              description="An approved loan is only paid out, or sent to the LMS, once the customer accepts its terms. Recommended — especially when the approved amount differs from what was asked."
              checked={offers.value.requireAcceptance}
              onChange={(requireAcceptance) => offers.set({ requireAcceptance })}
            />
            <Toggle
              id="require-signature"
              label="Accepting means signing"
              description="The customer reads the offer letter and loan agreement, signs (drawn or typed) and confirms with an emailed code. Signed copies, with a signature record page, are kept with the case."
              checked={offers.value.requireSignature !== false}
              onChange={(requireSignature) => offers.set({ requireSignature })}
              disabled={!offers.value.requireAcceptance}
            />
            <Field id="offer-days" label="Days to accept" hint="An offer not accepted in time lapses and the customer is told.">
              <Input id="offer-days" type="number" min="1" max="90" value={offers.value.expiryDays} onChange={(event) => offers.set({ expiryDays: event.target.value })} disabled={!offers.value.requireAcceptance} />
            </Field>
          </div>
          <FormError message={offers.error} />
          <SaveBar dirty={offers.dirty} saving={offers.saving} onSave={() => offers.save()} />
        </Panel>
        <Panel title="Automatic decisions">
          <Toggle
            id="auto-decline"
            label="Decline automatically when a rule says decline"
            description="Off: an officer reviews every case. On: the applicant is declined with no human review, which the Data Protection Act lets them challenge — use with care."
            checked={prescreen.value.autoDecline}
            onChange={(autoDecline) => prescreen.set({ autoDecline })}
          />
          <FormError message={prescreen.error} />
          <SaveBar dirty={prescreen.dirty} saving={prescreen.saving} onSave={() => prescreen.save()} />
        </Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

// Starting points when adding a stage, so the common ones are a click away.
const STAGE_SUGGESTIONS = {
  review: ['Document check', 'Field verification', 'Employer confirmation'],
  approval: ['Credit committee', 'Risk sign-off'],
  closing: ['Security documents signed', 'Insurance in place'],
}

const permissionLabel = (key) => PERMISSION_GROUPS.flatMap((group) => group.permissions).find((permission) => permission.key === key)?.label || key

const move = (list, index, by) => {
  const next = [...list]
  const target = index + by
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * Settings → Stages: the processing flow around the fixed backbone. Staff names for the
 * statuses, the verification checklist, and the workspace's own stages in each part of the
 * flow (src/config/stages.js). The server re-checks all of it on save.
 */
function StagesTab({ initial, notify }) {
  const { refresh } = useAuth()
  const group = useSettingGroup('stages', initial, notify)
  const value = group.value
  const roles = registeredRoles()
  const checklist = value.checklist || []

  const setLabel = (status, label) => group.set({ labels: { ...(value.labels || {}), [status]: label } })
  const setCheck = (index, changes) => group.set({ checklist: checklist.map((check, at) => (at === index ? { ...check, ...changes } : check)) })
  const setStage = (phase, index, changes) => group.set({ [phase]: value[phase].map((stage, at) => (at === index ? { ...stage, ...changes } : stage)) })
  const toggleIn = (list, item) => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item])
  const addStage = (phase, label = '') =>
    group.set({ [phase]: [...(value[phase] || []), { label, description: '', roles: [], checks: [], products: [], differentPerson: phase === 'approval' }] })

  const save = async () => {
    if (await group.save()) await refresh()
  }

  return (
    <div className="space-y-6">
      <Panel title="Status names" description="What staff see on the pipeline, lists and cases. Leave a box empty to keep the usual name. Customers keep their own plain wording.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RENAMABLE_STATUSES.map((status) => (
            <Field key={status} id={`label-${status}`} label={APPLICATION_STATUSES[status].label}>
              <Input id={`label-${status}`} value={value.labels?.[status] || ''} maxLength={40} placeholder={APPLICATION_STATUSES[status].label} onChange={(event) => setLabel(status, event.target.value)} />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Verification checklist" description="Officers tick these on each case, with a note of what they saw. Stages below can require them.">
        <ul className="space-y-3">
          {checklist.map((check, index) => (
            <li key={check.key || `new-${index}`} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] lg:items-center">
              <Input aria-label="Checklist item" value={check.label} maxLength={80} onChange={(event) => setCheck(index, { label: event.target.value })} placeholder="What is checked" />
              <Input aria-label="Guidance" value={check.hint || ''} maxLength={200} onChange={(event) => setCheck(index, { hint: event.target.value })} placeholder="Guidance for the officer (optional)" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(check.requiredToApprove)} onChange={(event) => setCheck(index, { requiredToApprove: event.target.checked })} className="size-4 accent-[hsl(var(--primary))]" />
                Needed to approve
              </label>
              <RowButtons onUp={() => group.set({ checklist: move(checklist, index, -1) })} onDown={() => group.set({ checklist: move(checklist, index, 1) })} onRemove={() => group.set({ checklist: checklist.filter((_, at) => at !== index) })} />
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => group.set({ checklist: [...checklist, { label: '', hint: '', requiredToApprove: false }] })}>
          <Plus />
          Add a checklist item
        </Button>
      </Panel>

      {Object.entries(STAGE_PHASES).map(([phase, meta]) => (
        <Panel key={phase} title={`Stages ${meta.label.toLowerCase()}`} description={meta.description}>
          {(value[phase] || []).length ? (
            <ol className="space-y-4">
              {value[phase].map((stage, index) => (
                <li key={stage.id || `new-${index}`} className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-2 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <Input aria-label="Stage name" value={stage.label} maxLength={60} onChange={(event) => setStage(phase, index, { label: event.target.value })} placeholder="Stage name" />
                      <Input aria-label="What happens" value={stage.description || ''} maxLength={300} onChange={(event) => setStage(phase, index, { description: event.target.value })} placeholder="What happens at this stage (optional)" />
                    </div>
                    <RowButtons
                      onUp={() => group.set({ [phase]: move(value[phase], index, -1) })}
                      onDown={() => group.set({ [phase]: move(value[phase], index, 1) })}
                      onRemove={() => group.set({ [phase]: value[phase].filter((_, at) => at !== index) })}
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <fieldset>
                      <legend className="text-xs font-medium text-muted-foreground">Who marks it done</legend>
                      <div className="mt-1.5 space-y-1">
                        {roles.filter((role) => role.key !== 'admin').map((role) => (
                          <label key={role.key} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={stage.roles.includes(role.key)} onChange={() => setStage(phase, index, { roles: toggleIn(stage.roles, role.key) })} className="size-4 accent-[hsl(var(--primary))]" />
                            {roleLabel(role.key)}
                          </label>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {stage.roles.length ? 'Administrators can always do it too.' : `None ticked: anyone who can “${permissionLabel(meta.defaultPermission).toLowerCase()}”.`}
                      </p>
                    </fieldset>
                    <fieldset>
                      <legend className="text-xs font-medium text-muted-foreground">Checks ticked first</legend>
                      <div className="mt-1.5 space-y-1">
                        {checklist.filter((check) => check.key).map((check) => (
                          <label key={check.key} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={stage.checks.includes(check.key)} onChange={() => setStage(phase, index, { checks: toggleIn(stage.checks, check.key) })} className="size-4 accent-[hsl(var(--primary))]" />
                            {check.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="text-xs font-medium text-muted-foreground">For which loans</legend>
                      <div className="mt-1.5 space-y-1">
                        {Object.entries(PRODUCT_NAMES).map(([product, name]) => (
                          <label key={product} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!stage.products.length || stage.products.includes(product)}
                              onChange={() => {
                                const current = stage.products.length ? stage.products : Object.keys(PRODUCT_NAMES)
                                setStage(phase, index, { products: toggleIn(current, product) })
                              }}
                              className="size-4 accent-[hsl(var(--primary))]"
                            />
                            {name}
                          </label>
                        ))}
                      </div>
                      {phase === 'approval' ? (
                        <label className="mt-3 flex items-start gap-2 text-sm">
                          <input type="checkbox" checked={stage.differentPerson !== false} onChange={(event) => setStage(phase, index, { differentPerson: event.target.checked })} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
                          <span>Not the recommender, or whoever brought the case in</span>
                        </label>
                      ) : null}
                    </fieldset>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No stages here: cases move on as usual.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => addStage(phase)}>
              <Plus />
              Add a stage
            </Button>
            {STAGE_SUGGESTIONS[phase]
              .filter((label) => !(value[phase] || []).some((stage) => stage.label === label))
              .map((label) => (
                <Button key={label} variant="ghost" size="sm" onClick={() => addStage(phase, label)}>
                  + {label}
                </Button>
              ))}
          </div>
        </Panel>
      ))}

      <div className="sticky bottom-0 rounded-lg border bg-background/95 p-4 shadow-lift backdrop-blur">
        <FormError message={group.error} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Changes apply to open cases straight away. Stages a case already finished stay done.</p>
          <Button size="sm" onClick={save} disabled={!group.dirty || group.saving}>
            {group.saving ? <Loader2 className="animate-spin" /> : null}
            Save the flow
          </Button>
        </div>
      </div>
    </div>
  )
}

function RowButtons({ onUp, onDown, onRemove }) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button type="button" variant="ghost" size="icon" aria-label="Move up" onClick={onUp}>
        <ArrowUp />
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label="Move down" onClick={onDown}>
        <ArrowDown />
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}

const PRODUCT_NAMES = { personal: 'Personal loan', business: 'Business loan' }

function ProductsTab({ initial, notify }) {
  const group = useSettingGroup('products', initial, notify)
  const update = (id, changes) => group.set({ [id]: { ...group.value[id], ...changes } })
  return (
    <div>
      <div className="grid gap-6 xl:grid-cols-2">
        {['personal', 'business'].map((id) => (
          <ProductForm key={id} id={id} pricing={group.value[id]} onChange={(changes) => update(id, changes)} />
        ))}
      </div>
      <FormError message={group.error} />
      <SaveBar dirty={group.dirty} saving={group.saving} onSave={() => group.save()}>
        <p className="mr-auto text-sm text-muted-foreground">Changes apply to new applications straight away. Submitted ones keep the price they were given.</p>
      </SaveBar>
    </div>
  )
}

function ProductForm({ id, pricing, onChange }) {
  const example = useMemo(() => priceLoan(Number(pricing.exampleAmount), Number(pricing.defaultTenure), { ...pricing, interestRate: Number(pricing.interestRate), facilityFee: Number(pricing.facilityFee) }), [pricing])
  const numberField = (key, label, props = {}) => (
    <Field id={`${id}-${key}`} label={label} hint={props.hint}>
      <Input id={`${id}-${key}`} type="number" step="any" value={pricing[key]} onChange={(event) => onChange({ [key]: event.target.value })} />
    </Field>
  )
  return (
    <Panel
      title={PRODUCT_NAMES[id]}
      action={<Toggle id={`${id}-enabled`} label="Offered" checked={pricing.enabled} onChange={(enabled) => onChange({ enabled })} />}
    >
      <div className={cn('space-y-5', !pricing.enabled && 'opacity-60')}>
        <div className="grid gap-4 sm:grid-cols-3">
          {numberField('minAmount', 'Smallest loan (K)')}
          {numberField('maxAmount', 'Largest loan (K)')}
          {numberField('exampleAmount', 'Example amount (K)', { hint: 'Used on the website' })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {numberField('minTenure', 'Shortest (months)')}
          {numberField('maxTenure', 'Longest (months)')}
          {numberField('defaultTenure', 'Starting tenure')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-rate`} label="Interest rate (%)">
            <Input
              id={`${id}-rate`}
              type="number"
              step="any"
              value={Number((Number(pricing.interestRate) * 100).toFixed(4))}
              onChange={(event) => onChange({ interestRate: Number(event.target.value) / 100 })}
            />
          </Field>
          <Field id={`${id}-basis`} label="Charged">
            <Select id={`${id}-basis`} value={pricing.interestBasis} onChange={(event) => onChange({ interestBasis: event.target.value })}>
              <option value="loan">Once, on the amount borrowed (flat)</option>
              <option value="month">Every month of the tenure</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-fee`} label={pricing.facilityFeeType === 'percent' ? 'Facility fee (%)' : 'Facility fee (K)'}>
            <Input
              id={`${id}-fee`}
              type="number"
              step="any"
              value={pricing.facilityFeeType === 'percent' ? Number((Number(pricing.facilityFee) * 100).toFixed(4)) : pricing.facilityFee}
              onChange={(event) => onChange({ facilityFee: pricing.facilityFeeType === 'percent' ? Number(event.target.value) / 100 : event.target.value })}
            />
          </Field>
          <Field id={`${id}-fee-type`} label="Fee type">
            <Select id={`${id}-fee-type`} value={pricing.facilityFeeType} onChange={(event) => onChange({ facilityFeeType: event.target.value, facilityFee: 0 })}>
              <option value="fixed">A fixed amount</option>
              <option value="percent">A percentage of the amount</option>
            </Select>
          </Field>
        </div>
        <div className="rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium text-foreground">
            {formatKwacha(pricing.exampleAmount)} over {pricing.defaultTenure} months: {formatKwacha(Math.round(example.monthly))} a month
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {describeInterest({ ...pricing, interestRate: Number(pricing.interestRate) })} interest ({formatKwacha(example.interest)}), fee {describeFee({ ...pricing, facilityFee: Number(pricing.facilityFee) })} ({formatKwacha(example.fee)}), total {formatKwacha(example.total)}.
          </p>
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------

function LmsTab({ settings, integrations, notify, onSaved }) {
  const connection = useSettingGroup('lmsConnection', settings.lmsConnection, notify)
  const timing = useSettingGroup('lms', settings.lms, notify)
  const [test, setTest] = useState(null)
  const [testing, setTesting] = useState(false)
  const value = connection.value
  const setMethod = (key, path) => connection.set({ methods: { ...value.methods, [key]: path } })

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await api('/settings/lms/test', { method: 'POST', body: { ...value, disbursedStatuses: value.disbursedStatuses } }))
    } catch (error) {
      setTest({ ok: false, message: error.message })
    } finally {
      setTesting(false)
    }
  }

  const envNote =
    integrations.lms.source === 'environment'
      ? 'Currently connected through environment variables. Switch this on to manage the connection here instead.'
      : integrations.lms.connected
        ? 'Connected.'
        : 'Not connected. The workspace runs on its own: applications are appraised and decided here, and nothing is sent anywhere.'

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel title="Connection" description={envNote}>
        <div className="space-y-5">
          <Toggle id="lms-enabled" label="Connect to the LMS" description="Frappe LMS. Enter the details the LMS team provides." checked={value.enabled} onChange={(enabled) => connection.set({ enabled })} />
          <Field id="lms-url" label="LMS address" hint="For example https://api.erp.lms.example.com">
            <Input id="lms-url" value={value.baseUrl} onChange={(event) => connection.set({ baseUrl: event.target.value })} placeholder="https://" />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Sign in with</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['token', 'API key and secret', 'Recommended: a Frappe integration user with only the permissions it needs.'],
                ['password', 'Username and password', 'The LMS login method. Use while an API key is not available.'],
              ].map(([method, label, hint]) => (
                <label key={method} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', value.authMethod === method && 'border-primary bg-primary/5')}>
                  <input type="radio" name="lms-auth" checked={value.authMethod === method} onChange={() => connection.set({ authMethod: method })} className="mt-1 accent-[hsl(var(--primary))]" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {value.authMethod === 'token' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="lms-key" label="API key">
                <Input id="lms-key" autoComplete="off" value={value.apiKey} onChange={(event) => connection.set({ apiKey: event.target.value })} />
              </Field>
              <SecretField id="lms-secret" label="API secret" isSet={value.apiSecretSet} value={value.apiSecret} onChange={(apiSecret) => connection.set({ apiSecret })} />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="lms-user" label="Username">
                <Input id="lms-user" autoComplete="off" value={value.username} onChange={(event) => connection.set({ username: event.target.value })} />
              </Field>
              <SecretField id="lms-password" label="Password" isSet={value.passwordSet} value={value.password} onChange={(password) => connection.set({ password })} />
            </div>
          )}
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced: method names and fields</summary>
            <p className="mt-2 text-xs text-muted-foreground">Change these only if the LMS team names their methods or fields differently.</p>
            <div className="mt-4 space-y-4">
              {[
                ['create', 'Create application method'],
                ['upload', 'Upload file method'],
                ['byEmail', 'Find applications by email method'],
                ['login', 'Login method (username and password only)'],
              ].map(([key, label]) => (
                <Field key={key} id={`lms-method-${key}`} label={label}>
                  <Input id={`lms-method-${key}`} value={value.methods[key]} onChange={(event) => setMethod(key, event.target.value)} className="font-mono text-xs" />
                </Field>
              ))}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="lms-ref" label="Field for our reference" hint="Lets the LMS spot a resend. Leave empty if the doctype has no such field.">
                  <Input id="lms-ref" value={value.referenceField} onChange={(event) => connection.set({ referenceField: event.target.value })} className="font-mono text-xs" />
                </Field>
                <Field id="lms-timeout" label="Timeout (seconds)">
                  <Input id="lms-timeout" type="number" min="5" max="300" value={value.timeoutSeconds} onChange={(event) => connection.set({ timeoutSeconds: event.target.value })} />
                </Field>
                <Field id="lms-status" label="Status field">
                  <Input id="lms-status" value={value.statusField} onChange={(event) => connection.set({ statusField: event.target.value })} className="font-mono text-xs" />
                </Field>
                <Field id="lms-paid" label="Statuses that mean paid out" hint="Comma-separated. Those loans are marked paid out here.">
                  <Input
                    id="lms-paid"
                    value={Array.isArray(value.disbursedStatuses) ? value.disbursedStatuses.join(', ') : value.disbursedStatuses}
                    onChange={(event) => connection.set({ disbursedStatuses: event.target.value.split(',').map((entry) => entry.trim()) })}
                  />
                </Field>
              </div>
            </div>
          </details>
          {test ? (
            <p role="status" className={cn('flex items-start gap-2 rounded-md p-3 text-sm', test.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
              {test.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              {test.message}
            </p>
          ) : null}
        </div>
        <FormError message={connection.error} />
        <SaveBar dirty={connection.dirty} saving={connection.saving} onSave={async () => (await connection.save()) && onSaved()}>
          <Button variant="outline" size="sm" onClick={runTest} disabled={testing || !value.baseUrl}>
            {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Test connection
          </Button>
        </SaveBar>
      </Panel>

      <Panel title="When to hand over">
        <fieldset className="space-y-2">
          {[
            ['approval', 'Once approved', settings.offers.requireAcceptance ? 'After the customer accepts the offer (acceptance is on in Credit workflow). Recommended.' : 'As soon as the decision is made. Recommended.'],
            ['submit', 'As soon as they’re submitted', 'The LMS gets every application, approved or not.'],
          ].map(([key, label, hint]) => (
            <label key={key} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', timing.value.syncOn === key && 'border-primary bg-primary/5')}>
              <input type="radio" name="sync-on" checked={timing.value.syncOn === key} onChange={() => timing.set({ syncOn: key })} className="mt-1 accent-[hsl(var(--primary))]" />
              <span>
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4">
          <Toggle
            id="send-prescreen"
            label="Include the prescreen"
            description="Adds the credit rules result and AI review as ai_prescreening. Needs that field on the Frappe doctype."
            checked={timing.value.sendPrescreen}
            onChange={(sendPrescreen) => timing.set({ sendPrescreen })}
          />
        </div>
        <FormError message={timing.error} />
        <SaveBar dirty={timing.dirty} saving={timing.saving} onSave={() => timing.save()} />
      </Panel>
    </div>
  )
}

/** A credential input: never shows the stored value; blank keeps it. */
function SecretField({ id, label, isSet, value, onChange, unsetHint = 'Stored encrypted.' }) {
  return (
    <Field id={id} label={label} hint={isSet ? 'Saved. Leave blank to keep it, or type a new one.' : unsetHint}>
      <Input id={id} type="password" autoComplete="new-password" placeholder={isSet ? '••••••••' : ''} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

// ---------------------------------------------------------------------------

function NotificationsTab({ settings, integrations, notify }) {
  const prefs = useSettingGroup('notifications', settings.notifications, notify)
  const sms = useSettingGroup('sms', settings.sms, notify)
  const [phone, setPhone] = useState('')
  const [test, setTest] = useState(null)

  const sendTest = async () => {
    setTest(null)
    try {
      setTest(await api('/settings/sms/test', { method: 'POST', body: { phone } }))
    } catch (error) {
      setTest({ ok: false, message: error.message })
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Who hears about what" description={integrations.email ? 'Email is set up.' : 'Email isn’t set up (EMAIL_* variables), so only in-app notifications work.'}>
        <div className="space-y-5">
          <Toggle
            id="staff-email"
            label="Email staff their notifications"
            description="New applications, cases assigned to them, customer replies, decisions waiting, and a daily overdue reminder. Each person can turn their emails off."
            checked={prefs.value.staffEmail}
            onChange={(staffEmail) => prefs.set({ staffEmail })}
          />
          <Toggle
            id="customer-sms"
            label="Text customers"
            description="When we need something from them, and when a decision is made. Needs an SMS provider."
            checked={prefs.value.customerSms}
            onChange={(customerSms) => prefs.set({ customerSms })}
          />
        </div>
        <FormError message={prefs.error} />
        <SaveBar dirty={prefs.dirty} saving={prefs.saving} onSave={() => prefs.save()} />
      </Panel>
      <Panel title="SMS provider">
        <div className="space-y-5">
          <Field id="sms-provider" label="Provider">
            <Select id="sms-provider" value={sms.value.provider} onChange={(event) => sms.set({ provider: event.target.value })}>
              <option value="none">None</option>
              <option value="africastalking">Africa’s Talking</option>
            </Select>
          </Field>
          {sms.value.provider === 'africastalking' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="sms-username" label="Username" hint="“sandbox” for their test environment.">
                  <Input id="sms-username" value={sms.value.username} onChange={(event) => sms.set({ username: event.target.value })} />
                </Field>
                <SecretField id="sms-key" label="API key" isSet={sms.value.apiKeySet} value={sms.value.apiKey} onChange={(apiKey) => sms.set({ apiKey })} />
              </div>
              <Field id="sms-sender" label="Sender ID (optional)" hint="Up to 11 characters, as registered with the provider.">
                <Input id="sms-sender" maxLength={11} value={sms.value.senderId} onChange={(event) => sms.set({ senderId: event.target.value })} />
              </Field>
              <div className="flex gap-2">
                <Input aria-label="Phone number for a test" placeholder="0971234567" value={phone} onChange={(event) => setPhone(event.target.value)} />
                <Button variant="outline" onClick={sendTest} disabled={!phone || sms.dirty}>
                  <Send />
                  Send test
                </Button>
              </div>
              {test ? <p className={cn('text-sm', test.ok ? 'text-success' : 'text-destructive')}>{test.message}</p> : null}
            </>
          ) : null}
        </div>
        <FormError message={sms.error} />
        <SaveBar dirty={sms.dirty} saving={sms.saving} onSave={() => sms.save()} />
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------------------

const AI_SERVICES = [...AI_MODEL_PROVIDERS, ...OCR_ENGINES]
const connectionLabel = (service) => AI_CONNECTIONS.find((connection) => connection.id === service.connection).label

function TestResult({ result }) {
  return (
    <p role="status" className={cn('flex items-start gap-2 rounded-md p-3 text-sm', result.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
      {result.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span className="break-words">{result.message}</span>
    </p>
  )
}

/** One connection field from src/config/aiProviders.js. */
function AiFieldInput({ field, value, fromEnv, onChange }) {
  const id = `ai-${field.key}`
  const envHint = fromEnv ? `Using ${field.env} from the environment. Type a value to replace it here.` : null
  if (field.kind === 'json') {
    return (
      <div className="sm:col-span-2">
        <Field id={id} label={field.label} hint={value[`${field.key}Set`] ? 'Saved. Leave blank to keep it, or paste a new one.' : envHint || 'Paste the whole JSON key file. Stored encrypted.'}>
          <textarea
            id={id}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={value[`${field.key}Set`] ? '••••••••' : '{ "type": "service_account", … }'}
            value={value[field.key] || ''}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
      </div>
    )
  }
  if (field.secret) {
    return <SecretField id={id} label={field.label} isSet={value[`${field.key}Set`]} value={value[field.key]} onChange={onChange} unsetHint={envHint || 'Stored encrypted.'} />
  }
  const hint = [field.hint, fromEnv ? `Blank uses ${field.env} from the environment.` : field.default ? `Blank uses ${field.default}.` : null].filter(Boolean).join(' ')
  return (
    <Field id={id} label={field.label} hint={hint || undefined}>
      <Input id={id} value={value[field.key] || ''} placeholder={field.placeholder || field.default || ''} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function AiTab({ settings, integrations, notify, onSaved }) {
  const ai = useSettingGroup('ai', settings.ai, notify)
  const [tests, setTests] = useState({})
  const { active, fallbacks, ocr, environment } = integrations.ai
  const value = ai.value
  const envSet = useMemo(() => new Set(environment.set), [environment.set])
  const has = (key) => Boolean(value[key] || value[`${key}Set`] || envSet.has(key) || AI_FIELDS.find((field) => field.key === key)?.default)
  const ready = (service) => isServiceReady(service, has)
  const chosenId = value.provider === 'environment' ? environment.provider : value.provider
  const chosen = AI_MODEL_PROVIDERS.find((entry) => entry.id === chosenId)
  const ocrEngine = OCR_ENGINES.find((entry) => entry.id === value.ocr)

  // Connections in use when the page loaded start open; the rest stay folded.
  const inUse = useMemo(() => {
    const saved = settings.ai
    const savedChoice = saved.provider === 'environment' ? environment.provider : saved.provider
    const ids = [savedChoice, ...(saved.fallback ? saved.fallbacks : []), saved.ocr]
    return new Set(AI_SERVICES.filter((service) => ids.includes(service.id)).map((service) => service.connection))
  }, [settings.ai, environment.provider])

  const runTest = async (service) => {
    setTests((prev) => ({ ...prev, [service.id]: { pending: true } }))
    const connection = AI_CONNECTIONS.find((entry) => entry.id === service.connection)
    const values = Object.fromEntries(connection.fields.filter((field) => value[field.key]).map((field) => [field.key, value[field.key]]))
    let result
    try {
      result = await api('/settings/ai/test', { method: 'POST', body: { service: service.id, values } })
    } catch (error) {
      result = { ok: false, message: error.message }
    }
    setTests((prev) => ({ ...prev, [service.id]: result }))
  }

  // Fallbacks run in the order they are listed here.
  const toggleFallback = (id, on) =>
    ai.set({ fallbacks: AI_MODEL_PROVIDERS.map((entry) => entry.id).filter((entryId) => (entryId === id ? on : value.fallbacks.includes(entryId))) })

  const save = async () => (await ai.save()) && onSaved()

  const status = active
    ? `In use: ${active.label} (${active.model})${fallbacks.length ? `, then ${fallbacks.map((entry) => `${entry.label} (${entry.model})`).join(', then ')} when it’s busy` : ''}.${
        ocr ? ` ${ocr.label} ${ocr.mode === 'always' ? 'reads every file first' : 'reads files the model can’t open'}.` : ''
      }`
    : 'Off. Applicants and staff see no AI notes; everything else works as usual.'

  return (
    <div className="space-y-6">
      <Panel title="How documents are read" description={status}>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ai-provider" label="Model">
              <Select id="ai-provider" value={value.provider} onChange={(event) => ai.set({ provider: event.target.value })}>
                <option value="environment">As set in the environment (AI_PROVIDER={environment.provider})</option>
                {AI_MODEL_PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                    {ready(entry) ? '' : ' (not set up)'}
                  </option>
                ))}
                <option value="off">Off</option>
              </Select>
            </Field>
          </div>
          {chosen && !ready(chosen) ? (
            <p className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Fill in the {connectionLabel(chosen)} connection below, or AI checks stay off.
            </p>
          ) : null}
          <Toggle
            id="ai-fallback"
            label="Fall back when the model is busy"
            description="When the chosen model is overloaded, rate-limited or doesn’t answer in time, the same check goes to these, in this order. Ones not set up are skipped."
            checked={value.fallback}
            onChange={(fallback) => ai.set({ fallback })}
          />
          {value.fallback ? (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Fallback models</legend>
              {AI_MODEL_PROVIDERS.filter((entry) => entry.id !== chosenId).map((entry) => (
                <label key={entry.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={value.fallbacks.includes(entry.id)} onChange={(event) => toggleFallback(entry.id, event.target.checked)} className="accent-[hsl(var(--primary))]" />
                  {entry.label}
                  {ready(entry) ? null : <span className="text-muted-foreground">(not set up)</span>}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
            <Field id="ai-ocr" label="OCR step" hint="Reads the text out of each file before the model sees it. Lets a model that can’t open PDFs check them.">
              <Select id="ai-ocr" value={value.ocr} onChange={(event) => ai.set({ ocr: event.target.value })}>
                <option value="off">None</option>
                {OCR_ENGINES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                    {ready(entry) ? '' : ' (not set up)'}
                  </option>
                ))}
              </Select>
            </Field>
            {ocrEngine ? (
              <Field id="ai-ocr-mode" label="Run it">
                <Select id="ai-ocr-mode" value={value.ocrMode} onChange={(event) => ai.set({ ocrMode: event.target.value })}>
                  <option value="when_needed">Only for files the model can’t open</option>
                  <option value="always">For every file, alongside the file</option>
                </Select>
              </Field>
            ) : null}
          </div>
          {ocrEngine && !ready(ocrEngine) ? (
            <p className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Fill in the {connectionLabel(ocrEngine)} connection below, or the OCR step is skipped.
            </p>
          ) : ocrEngine?.hint ? (
            <p className="text-xs text-muted-foreground">{ocrEngine.hint}</p>
          ) : null}
        </div>
        <FormError message={ai.error} />
        <SaveBar dirty={ai.dirty} saving={ai.saving} onSave={save} />
      </Panel>

      <Panel title="Connections" description="Keys are stored encrypted and never shown again. A field left blank uses its environment variable, if one is set. Test buttons use what is typed here, before saving.">
        <div className="space-y-3">
          {AI_CONNECTIONS.map((connection) => {
            const services = AI_SERVICES.filter((service) => service.connection === connection.id)
            const setUp = connection.fields.filter((field) => field.required).every((field) => has(field.key))
            return (
              <details key={connection.id} open={inUse.has(connection.id)} className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  {connection.label}
                  <span className={cn('ml-2 text-xs font-normal', setUp ? 'text-success' : 'text-muted-foreground')}>{setUp ? 'Set up' : 'Not set up'}</span>
                </summary>
                {connection.hint ? <p className="mt-2 text-xs text-muted-foreground">{connection.hint}</p> : null}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {connection.fields.map((field) => (
                    <AiFieldInput key={field.key} field={field} value={value} fromEnv={envSet.has(field.key)} onChange={(fieldValue) => ai.set({ [field.key]: fieldValue })} />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {services.map((service) => (
                    <Button key={service.id} variant="outline" size="sm" onClick={() => runTest(service)} disabled={tests[service.id]?.pending || !ready(service)}>
                      {tests[service.id]?.pending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                      Test {service.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 space-y-2 empty:hidden">
                  {services.map((service) => (tests[service.id] && !tests[service.id].pending ? <TestResult key={service.id} result={tests[service.id]} /> : null))}
                </div>
              </details>
            )
          })}
        </div>
        <FormError message={ai.error} />
        <SaveBar dirty={ai.dirty} saving={ai.saving} onSave={save} />
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------------------

const RETENTION_FIELDS = [
  ['declinedDays', 'Declined applications', 'Counted from the decision.'],
  ['withdrawnDays', 'Withdrawn applications', 'Counted from the withdrawal.'],
  ['expiredDays', 'Offers not accepted', 'Counted from when the offer lapsed.'],
  ['disbursedDays', 'Paid-out loans', 'Usually kept: these are loan records. Leave empty to keep.'],
  ['auditLogDays', 'Audit log entries', 'Leave empty to keep the full trail.'],
]

function RetentionTab({ initial, notify }) {
  const group = useSettingGroup('retention', initial, notify)
  return (
    <Panel title="How long to keep closed applications" description="Past these periods, applications are deleted with their documents during the daily maintenance. Empty keeps them indefinitely.">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {RETENTION_FIELDS.map(([key, label, hint]) => (
          <Field key={key} id={`retention-${key}`} label={`${label} (days)`} hint={hint}>
            <Input id={`retention-${key}`} type="number" min="1" placeholder="Keep" value={group.value[key] ?? ''} onChange={(event) => group.set({ [key]: event.target.value === '' ? null : event.target.value })} />
          </Field>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">To act on a request from one person — a copy of their data, or erasure — use Data requests.</p>
      <FormError message={group.error} />
      <SaveBar dirty={group.dirty} saving={group.saving} onSave={() => group.save()} />
    </Panel>
  )
}

function SecurityTab({ initial, notify }) {
  const group = useSettingGroup('security', initial, notify)
  const roles = group.value.requireTwoFactorRoles || []
  const toggle = (role) => group.set({ requireTwoFactorRoles: roles.includes(role) ? roles.filter((entry) => entry !== role) : [...roles, role] })
  return (
    <Panel title="Two-step sign-in" description="Staff in these roles must use an authenticator app code as well as their password. Anyone without it set up is asked to do so before they can continue.">
      <div className="grid gap-2 sm:grid-cols-2">
        {registeredRoles().map(({ key: role }) => (
          <label key={role} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
            <input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} className="size-4 accent-[hsl(var(--primary))]" />
            {roleLabel(role)}
          </label>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">Recommended for administrators and loan officers. Make sure you have set it up yourself first, from your profile.</p>
      <FormError message={group.error} />
      <SaveBar dirty={group.dirty} saving={group.saving} onSave={() => group.save()} />
    </Panel>
  )
}

// ---------------------------------------------------------------------------

const LEGAL_LABELS = { terms: 'Terms and conditions', privacy: 'Privacy notice' }

function LegalTab({ notify, onPublished }) {
  const [kind, setKind] = useState('terms')
  const [state, setState] = useState({ status: 'loading' })
  const [form, setForm] = useState({ title: '', body: '' })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const data = await api(`/admin/legal/${kind}`)
      setState({ status: 'ready', ...data })
      const source = data.draft || data.published
      setForm({ title: source.title, body: source.body })
    } catch (loadError) {
      setState({ status: 'error', message: loadError.message })
    }
  }, [kind])

  useEffect(() => {
    load()
  }, [load])

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setBusy(null)
    }
  }

  if (state.status !== 'ready') {
    return state.status === 'error' ? <FormError message={state.message} /> : <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
  }

  const source = state.draft || state.published
  const dirty = form.title !== source.title || form.body !== source.body
  const editing = Boolean(state.draft) || dirty

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(LEGAL_LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            aria-pressed={kind === value}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium', kind === value ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
          >
            {label}
          </button>
        ))}
        <p className="ml-auto text-sm text-muted-foreground">
          In force: version {state.published.version}, published {dateTime(state.published.publishedAt)}
        </p>
      </div>
      {state.placeholder ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Applicants are seeing the built-in placeholder wording. Replace it with the lender’s approved text and publish.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={editing ? 'Draft' : 'Edit'} description="Blank lines separate paragraphs. Start a line with ## for a heading, or - for a list item.">
          <div className="space-y-4">
            <Field id="legal-title" label="Title">
              <Input id="legal-title" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
            </Field>
            <Field id="legal-body" label="Text">
              <textarea
                id="legal-body"
                rows={18}
                value={form.body}
                onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          </div>
          <FormError message={error} />
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
            {state.draft ? (
              <Button variant="ghost" size="sm" onClick={() => run('discard', async () => { await api(`/admin/legal/${kind}/draft`, { method: 'DELETE' }); notify('Draft discarded'); await load() })} disabled={Boolean(busy)}>
                <Undo2 />
                Discard draft
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={!dirty || Boolean(busy)} onClick={() => run('save', async () => { await api(`/admin/legal/${kind}/draft`, { method: 'PUT', body: form }); notify('Draft saved'); await load() })}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : null}
              Save draft
            </Button>
            <Button
              size="sm"
              disabled={!editing || Boolean(busy)}
              onClick={() =>
                run('publish', async () => {
                  if (dirty) await api(`/admin/legal/${kind}/draft`, { method: 'PUT', body: form })
                  const { published } = await api(`/admin/legal/${kind}/publish`, { method: 'POST' })
                  notify(`Version ${published.version} is now what applicants see`)
                  await load()
                  onPublished()
                })
              }
            >
              {busy === 'publish' ? <Loader2 className="animate-spin" /> : <Rocket />}
              Publish
            </Button>
          </div>
        </Panel>
        <Panel title="Preview" description="What applicants see before they submit.">
          <h3 className="text-base font-semibold text-foreground">{form.title}</h3>
          <SimpleText text={form.body} className="mt-3 text-sm leading-relaxed text-muted-foreground" />
        </Panel>
      </div>
      {state.history.length > 1 ? (
        <Panel title="Earlier versions">
          <ul className="space-y-1 text-sm">
            {state.history.map((entry) => (
              <li key={entry.id} className="text-muted-foreground">
                <span className="font-medium text-foreground">Version {entry.version}</span>, {entry.status === 'published' ? 'in force' : 'retired'}, published {dateTime(entry.publishedAt)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Each application records the versions its applicant accepted.</p>
        </Panel>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function SampleData({ notify }) {
  const [busy, setBusy] = useState(null)
  const run = async (key, path, message) => {
    setBusy(key)
    try {
      const result = await api(path, { method: 'POST', body: { count: 60 } })
      notify(message(result))
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <Panel title="Sample data" description="Demo access is on here. Fill the workspace with realistic applications to show it off.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => run('seed', '/demo/seed', (result) => `Added ${result.created} sample applications`)} disabled={Boolean(busy)}>
          {busy === 'seed' ? <Loader2 className="animate-spin" /> : <Database />}
          Add 60 sample applications
        </Button>
        <Button variant="ghost" onClick={() => run('clear', '/demo/clear', (result) => `Removed ${result.removed} sample applications`)} disabled={Boolean(busy)}>
          {busy === 'clear' ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Clear sample data
        </Button>
      </div>
    </Panel>
  )
}
