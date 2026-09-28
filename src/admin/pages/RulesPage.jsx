import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Loader2, Plus, Rocket, Save, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FACTS, OPERATORS, OUTCOMES, describeCondition, validateRules } from '@/config/creditRules'
import { LOAN_TYPE_LABELS } from '@/config/applications'
import { api } from '../api'
import { useAuth } from '../auth'
import { FormError, PageHeader, Panel, dateTime, useToast } from '../components'

const OUTCOME_TONE = { decline: 'text-destructive', refer: 'text-warning', warn: 'text-muted-foreground' }

let tempId = 0
const blankRule = () => ({ id: `new${Date.now()}${(tempId += 1)}`, fact: 'debt_to_income', operator: 'gt', value: 0.4, outcome: 'refer', message: '', loanTypes: ['personal'], enabled: true })

export function RulesPage() {
  const { user } = useAuth()
  const notify = useToast()
  const canEdit = user.role === 'admin'
  const [state, setState] = useState({ status: 'loading' })
  const [rules, setRules] = useState([])
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [simulation, setSimulation] = useState(null)
  const [publishOpen, setPublishOpen] = useState(false)

  const load = async () => {
    try {
      const data = await api('/rules')
      setState({ status: 'ready', ...data })
      setRules((data.draft || data.published).rules)
      setNote(data.draft?.note || '')
      setDirty(false)
      setSimulation(null)
    } catch (loadError) {
      setState({ status: 'error', message: loadError.message })
    }
  }

  useEffect(() => {
    load()
  }, [])

  const validation = useMemo(() => {
    try {
      validateRules(rules)
      return null
    } catch (validationError) {
      return validationError.message
    }
  }, [rules])

  const update = (index, changes) => {
    setRules((current) => current.map((rule, position) => (position === index ? { ...rule, ...changes } : rule)))
    setDirty(true)
    setSimulation(null)
  }

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

  const saveDraft = () =>
    run('save', async () => {
      await api('/rules/draft', { method: 'PUT', body: { rules, note } })
      notify('Draft saved')
      await load()
    })

  const simulate = () =>
    run('simulate', async () => {
      setSimulation(await api('/rules/simulate', { method: 'POST', body: { rules } }))
    })

  const discard = () =>
    run('discard', async () => {
      await api('/rules/draft', { method: 'DELETE' })
      notify('Draft discarded')
      await load()
    })

  const publish = () =>
    run('publish', async () => {
      if (dirty) await api('/rules/draft', { method: 'PUT', body: { rules, note } })
      const { published } = await api('/rules/publish', { method: 'POST', body: { note } })
      setPublishOpen(false)
      notify(`Version ${published.version} is now in force`)
      await load()
    })

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the credit rules…
      </p>
    )
  }
  if (state.status === 'error') return <FormError message={state.message} />

  const editing = Boolean(state.draft) || dirty

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit rules"
        description="The lender’s policy, checked automatically on every application. Rules recommend; an officer decides unless automatic decline is on in Settings."
        actions={
          canEdit ? (
            <>
              {editing ? (
                <Button variant="ghost" onClick={discard} disabled={Boolean(busy)}>
                  <Undo2 />
                  Discard draft
                </Button>
              ) : null}
              <Button variant="outline" onClick={simulate} disabled={Boolean(busy) || Boolean(validation)}>
                {busy === 'simulate' ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Try on recent applications
              </Button>
              <Button variant="outline" onClick={saveDraft} disabled={Boolean(busy) || !dirty || Boolean(validation)}>
                {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
                Save draft
              </Button>
              <Button onClick={() => setPublishOpen(true)} disabled={Boolean(busy) || !editing || Boolean(validation)}>
                <Rocket />
                Publish
              </Button>
            </>
          ) : null
        }
      />

      <p className="text-sm text-muted-foreground">
        {state.draft || dirty ? (
          <span className="font-medium text-warning">Editing a draft. Version {state.published.version} stays in force until you publish.</span>
        ) : (
          <>In force: version {state.published.version}, published {dateTime(state.published.publishedAt)}.</>
        )}
        {state.published.note && !editing ? ` ${state.published.note}` : ''}
      </p>

      {error || (canEdit && validation && dirty) ? <FormError message={error || validation} /> : null}

      {simulation ? <SimulationResult simulation={simulation} /> : null}

      <div className="overflow-hidden rounded-xl border bg-card">
        {!canEdit ? (
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2fr)_9rem] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid">
            <span>When</span>
            <span>Then</span>
            <span>What the officer sees</span>
            <span>Applies to</span>
          </div>
        ) : null}
        <ul className="divide-y">
          {rules.map((rule, index) =>
            canEdit ? (
              <RuleEditor key={rule.id} rule={rule} onChange={(changes) => update(index, changes)} onRemove={() => { setRules((current) => current.filter((_, position) => position !== index)); setDirty(true) }} />
            ) : (
              <li key={rule.id} className={cn('grid gap-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2fr)_9rem]', !rule.enabled && 'opacity-50')}>
                <span className="text-foreground">{describeCondition(rule)}</span>
                <span className={cn('font-medium', OUTCOME_TONE[rule.outcome])}>{OUTCOMES[rule.outcome].label}</span>
                <span className="text-muted-foreground">{rule.message}</span>
                <span className="text-xs text-muted-foreground">{rule.loanTypes.map((type) => LOAN_TYPE_LABELS[type]).join(', ')}</span>
              </li>
            )
          )}
        </ul>
        {canEdit ? (
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={() => { setRules((current) => [...current, blankRule()]); setDirty(true) }}>
              <Plus />
              Add a rule
            </Button>
          </div>
        ) : null}
      </div>

      {state.history.length > 1 ? (
        <Panel title="Earlier versions">
          <ul className="space-y-2 text-sm">
            {state.history.map((version) => (
              <li key={version.version} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium text-foreground">Version {version.version}</span>
                <span className="text-muted-foreground">
                  {version.status === 'published' ? 'in force' : 'retired'}, {version.ruleCount} rules, published {dateTime(version.publishedAt)}
                </span>
                {version.note ? <span className="text-muted-foreground">{version.note}</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Each prescreen records the version it used. Changes are also in the <Link to="/admin/audit" className="text-primary hover:underline">audit log</Link>.
          </p>
        </Panel>
      ) : null}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish version {state.published.version + 1}?</DialogTitle>
            <DialogDescription>New applications are checked against it straight away. Existing prescreens keep their version until someone runs them again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="publish-note" className="text-sm font-medium">
              What changed and why
            </label>
            <Input id="publish-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Debt-to-income limit set to credit committee’s 35%" />
          </div>
          {error ? <FormError message={error} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={busy === 'publish'}>
              {busy === 'publish' ? <Loader2 className="animate-spin" /> : <Rocket />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RuleEditor({ rule, onChange, onRemove }) {
  const fact = FACTS[rule.fact]
  const operator = OPERATORS[rule.operator]
  const toggleType = (type) => {
    const next = rule.loanTypes.includes(type) ? rule.loanTypes.filter((entry) => entry !== type) : [...rule.loanTypes, type]
    onChange({ loanTypes: next })
  }
  return (
    <li className={cn('grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] gap-x-3 gap-y-2 px-4 py-4 lg:grid-cols-[2rem_minmax(0,1fr)_12rem_2.5rem]', !rule.enabled && 'bg-muted/30')}>
      <input
        type="checkbox"
        checked={rule.enabled}
        onChange={(event) => onChange({ enabled: event.target.checked })}
        className="mt-2.5 size-4 accent-[hsl(var(--primary))]"
        aria-label="Rule on"
      />
      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_7rem]">
          <Select
            aria-label="What it checks"
            value={rule.fact}
            onChange={(event) => {
              const next = FACTS[event.target.value]
              onChange({ fact: event.target.value, loanTypes: next.loanTypes, value: next.unit === 'boolean' ? false : rule.value })
            }}
            className="h-9 text-sm"
          >
            {Object.entries(FACTS).map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Comparison" value={rule.operator} onChange={(event) => onChange({ operator: event.target.value })} className="h-9 text-sm">
            {Object.entries(OPERATORS).map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </Select>
          {operator?.noValue ? (
            <span />
          ) : fact?.unit === 'boolean' ? (
            <Select aria-label="Value" value={String(rule.value)} onChange={(event) => onChange({ value: event.target.value === 'true' })} className="h-9 text-sm">
              <option value="true">yes</option>
              <option value="false">no</option>
            </Select>
          ) : (
            <Input aria-label="Value" type="number" step="any" value={rule.value ?? ''} onChange={(event) => onChange({ value: event.target.value })} className="h-9 text-sm" />
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="Message for the officer"
            value={rule.message}
            onChange={(event) => onChange({ message: event.target.value })}
            placeholder="What the concern is, in words the officer will read"
            className="h-9 flex-1 text-sm"
          />
          <div className="flex gap-1">
            {['personal', 'business'].map((type) => (
              <button
                key={type}
                type="button"
                disabled={!fact?.loanTypes.includes(type)}
                onClick={() => toggleType(type)}
                aria-pressed={rule.loanTypes.includes(type)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                  rule.loanTypes.includes(type) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {type === 'personal' ? 'Personal' : 'Business'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* self-start: the row is two lines tall, and a stretched wrapper would centre the chevron between them. */}
      <div className="col-start-2 self-start lg:col-start-auto">
        <Select aria-label="Then" value={rule.outcome} onChange={(event) => onChange({ outcome: event.target.value })} className={cn('h-9 text-sm font-medium', OUTCOME_TONE[rule.outcome])}>
          {Object.entries(OUTCOMES).map(([key, entry]) => (
            <option key={key} value={key}>
              Then: {entry.label.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove rule" className="row-start-1 h-9 w-9 text-muted-foreground hover:text-destructive lg:row-start-auto">
        <Trash2 />
      </Button>
    </li>
  )
}

const OUTCOME_KEYS = ['pass', 'refer', 'decline']
const OUTCOME_NAMES = { pass: 'Pass', refer: 'Refer', decline: 'Decline' }

/** Before/after split of recent applications, and the ones that would change. */
function SimulationResult({ simulation }) {
  if (!simulation.sample) {
    return <Panel title="Trial run">No prescreened applications yet to try the rules on.</Panel>
  }
  return (
    <Panel title="Trial run" description={`The last ${simulation.sample} prescreened applications, replayed with these rules.`}>
      <div className="grid gap-4 sm:grid-cols-3">
        {OUTCOME_KEYS.map((key) => {
          const before = simulation.current[key]
          const after = simulation.proposed[key]
          const delta = after - before
          return (
            <div key={key} className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{OUTCOME_NAMES[key]}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {after}
                <span className={cn('ml-2 text-sm font-medium', delta === 0 ? 'text-muted-foreground' : delta > 0 ? (key === 'pass' ? 'text-success' : 'text-warning') : key === 'pass' ? 'text-warning' : 'text-success')}>
                  {delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${delta}`}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">was {before}</p>
            </div>
          )
        })}
      </div>
      {simulation.changedCount ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">
            {simulation.changedCount} {simulation.changedCount === 1 ? 'application would change' : 'applications would change'}
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
            {simulation.changed.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-2">
                <Link to={`/admin/applications/${row.id}`} className="font-medium text-primary hover:underline">
                  {row.reference}
                </Link>
                <span className="text-muted-foreground">
                  {row.applicantName}: {OUTCOME_NAMES[row.from]} to {OUTCOME_NAMES[row.to]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No outcome would change.</p>
      )}
    </Panel>
  )
}
