/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, LayoutGrid, List, ListChecks, Loader2, Plus, Rocket, Trash2, Undo2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { registeredRoles } from '@/config/roles'
import { validateWorkflow } from '@/config/workflow'
import { api } from '../api'
import { useAuth } from '../auth'
import { FormError, PageHeader, Panel, dateTime, useToast } from '../components'
import { FlowBoard } from '../workflow/FlowBoard'
import { TreePreview } from '../workflow/TreePreview'
import { StateDrawer } from '../workflow/StateDrawer'
import { StepList } from '../workflow/StepList'
import { addAction, addState, changeChecklist, connect, connectToNew, forEditing, moveStateBefore, moveStep, setStateEnabled } from '../workflow/editing'

/*
 * Settings for the loan workflow (src/config/workflow.js): the states an application moves
 * through, who works on each, and what happens next. Edits make a draft; publishing makes
 * it the version new applications follow, while open cases finish on theirs.
 */

const HINT_KEY = 'los:workflow-hint-dismissed'
const VIEW_KEY = 'los:workflow-view'
const VIEWS = [
  ['list', 'List', List],
  ['flow', 'Flow', LayoutGrid],
  ['tree', 'Tree preview', GitBranch],
]

// The view this browser used last; storage may be blocked, which just means the default.
const readView = () => {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY)
    return VIEWS.some(([key]) => key === saved) ? saved : 'flow'
  } catch {
    return 'flow'
  }
}

const readHintDismissed = () => {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

function ChecklistDialog({ open, onOpenChange, checklist, onSave }) {
  const [items, setItems] = useState(checklist)
  useEffect(() => {
    if (open) setItems(checklist)
  }, [open, checklist])
  const set = (index, changes) => setItems((list) => list.map((item, at) => (at === index ? { ...item, ...changes } : item)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Verification checklist</DialogTitle>
          <DialogDescription>Staff tick these on each case, with a note of what they saw. States and actions can require them.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {items.map((item, index) => (
            <li key={item.key || `new-${index}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
              <Input aria-label="Check" value={item.label} maxLength={80} placeholder="What is checked" onChange={(event) => set(index, { label: event.target.value })} />
              <Input aria-label="Guidance" value={item.hint || ''} maxLength={200} placeholder="Guidance (optional)" onChange={(event) => set(index, { hint: event.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setItems((list) => list.filter((_, at) => at !== index))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={() => setItems((list) => [...list, { label: '', hint: '', requiredToApprove: false }])}>
            <Plus />
            Add a check
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={items.some((item) => item.label.trim().length < 2)}
            onClick={() => {
              onSave(items)
              onOpenChange(false)
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function History({ history, publishedVersion, onMove, moving }) {
  const older = history.filter((entry) => entry.version !== publishedVersion && entry.openCases > 0)
  return (
    <Panel title="Versions" description="New applications follow the published version. Open cases finish on the one they started with.">
      <ul className="divide-y text-sm">
        {history.map((entry) => (
          <li key={entry.version} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="font-medium text-foreground">
              Version {entry.version}
              {entry.version === publishedVersion ? <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">Published</span> : null}
              {entry.legacy ? <span className="ml-2 text-xs font-normal text-muted-foreground">from the settings</span> : null}
            </span>
            <span className="text-muted-foreground">
              {entry.openCases ? `${entry.openCases} open ${entry.openCases === 1 ? 'case' : 'cases'} · ` : ''}
              {entry.publishedAt ? dateTime(entry.publishedAt) : ''}
            </span>
          </li>
        ))}
      </ul>
      {older.length ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Open cases on older versions can move to version {publishedVersion} where their state still exists there.</span>
          <Button type="button" variant="outline" size="sm" onClick={onMove} disabled={moving}>
            {moving ? <Loader2 className="animate-spin" /> : null}
            Move them to version {publishedVersion}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}

export function WorkflowPage() {
  const notify = useToast()
  const { refresh } = useAuth()
  const [loaded, setLoaded] = useState({ status: 'loading' })
  const [definition, setDefinition] = useState(null)
  const [saved, setSaved] = useState(null)
  const [view, setViewState] = useState(readView)
  const [editing, setEditing] = useState(null)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api('/admin/workflow')
      const start = forEditing(data.draft?.definition || data.published.definition)
      setLoaded({ status: 'ready', ...data })
      setDefinition(start)
      setSaved(JSON.stringify(start))
    } catch (loadError) {
      setLoaded({ status: 'error', message: loadError.message })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const roles = useMemo(() => registeredRoles(), [])
  const documentKinds = loaded.documentKinds
  const validation = useMemo(() => (definition ? validateWorkflow(definition, { roles, documentKinds }) : { errors: [], warnings: [] }), [definition, roles, documentKinds])
  const errorsByState = useMemo(() => {
    const counts = {}
    validation.errors.forEach((entry) => {
      if (entry.stateId) counts[entry.stateId] = (counts[entry.stateId] || 0) + 1
    })
    return counts
  }, [validation])

  if (loaded.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the workflow…
      </p>
    )
  }
  if (loaded.status === 'error') return <FormError message={loaded.message} />

  const dirty = JSON.stringify(definition) !== saved
  const hasDraft = Boolean(loaded.draft) || dirty
  const run = async (key, action) => {
    setBusy(key)
    setError('')
    try {
      await action()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = () =>
    run('save', async () => {
      const result = await api('/admin/workflow/draft', { method: 'PUT', body: { definition } })
      const next = forEditing(result.draft.definition)
      setDefinition(next)
      setSaved(JSON.stringify(next))
      setLoaded((prev) => ({ ...prev, draft: result.draft }))
      notify('Draft saved')
    })

  const publish = () =>
    run('publish', async () => {
      if (dirty || !loaded.draft) await api('/admin/workflow/draft', { method: 'PUT', body: { definition } })
      await api('/admin/workflow/publish', { method: 'POST', body: {} })
      await load()
      await refresh()
      notify('Workflow published. New applications follow it from now on.')
    })

  const discard = () =>
    run('discard', async () => {
      if (loaded.draft) await api('/admin/workflow/draft', { method: 'DELETE' })
      await load()
      notify('Draft discarded')
    })

  const moveCases = () =>
    run('move', async () => {
      const { moved, kept } = await api('/admin/workflow/move-cases', { method: 'POST', body: {} })
      await load()
      notify(`${moved} ${moved === 1 ? 'case' : 'cases'} moved${kept ? `; ${kept} stay on their version (their state isn’t in this one)` : ''}`)
    })

  const setView = (next) => {
    setViewState(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Storage blocked: the view isn't remembered.
    }
  }
  const edit = (stateId, actionId = null) => setEditing({ stateId, actionId })
  const addNewState = () => {
    const { definition: next, id } = addState(definition, { label: 'New state' })
    setDefinition(next)
    edit(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loan application workflow"
        description="Set up the states an application moves through, who’s responsible at each one, and what happens next."
        actions={
          <>
            {hasDraft ? (
              <Button variant="ghost" onClick={discard} disabled={Boolean(busy)}>
                {busy === 'discard' ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Discard changes
              </Button>
            ) : null}
            <Button variant="outline" onClick={saveDraft} disabled={Boolean(busy) || !dirty}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : null}
              Save draft
            </Button>
            <Button onClick={publish} disabled={Boolean(busy) || !hasDraft || validation.errors.length > 0}>
              {busy === 'publish' ? <Loader2 className="animate-spin" /> : <Rocket />}
              Save workflow
            </Button>
          </>
        }
      />

      {loaded.published.legacy ? (
        <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-foreground">
            This workflow is made from Settings → Stages and the credit workflow settings, and follows them until you save one here. After that, it is managed here only.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-card p-1" role="tablist" aria-label="View">
          {VIEWS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn('inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors', view === key ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted')}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setChecklistOpen(true)}>
            <ListChecks />
            Checklist
          </Button>
          <Button variant="outline" onClick={addNewState}>
            <Plus />
            Add state
          </Button>
        </div>
      </div>

      {view === 'flow' && !hintDismissed ? (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">
          <p>Drag a card’s grip to reorder it. Drag the + on its edge onto another card to connect them, or onto empty space to create a new connected state.</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setHintDismissed(true)
              try {
                window.localStorage.setItem(HINT_KEY, '1')
              } catch {
                // Storage blocked: it just comes back next time.
              }
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <FormError message={error} />
      {validation.errors.length ? (
        <Panel title={`${validation.errors.length} ${validation.errors.length === 1 ? 'thing needs' : 'things need'} fixing before it can be saved`}>
          <ul className="space-y-1.5 text-sm">
            {validation.errors.map((entry, index) => (
              <li key={index}>
                {entry.stateId ? (
                  <button type="button" className="text-left text-destructive hover:underline" onClick={() => edit(entry.stateId, entry.actionId)}>
                    {entry.message}
                  </button>
                ) : (
                  <span className="text-destructive">{entry.message}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {validation.warnings.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {validation.warnings.map((entry, index) => (
            <li key={index}>{entry.message}</li>
          ))}
        </ul>
      ) : null}

      {view === 'list' ? (
        <StepList
          definition={definition}
          errorsByState={errorsByState}
          onEdit={edit}
          onMove={(id, beforeId) => setDefinition(moveStep(definition, id, beforeId))}
          onToggle={(id, enabled) => setDefinition(setStateEnabled(definition, id, enabled))}
        />
      ) : view === 'flow' ? (
        <FlowBoard
          definition={definition}
          errorsByState={errorsByState}
          onEdit={edit}
          onReorder={(id, beforeId) => setDefinition(moveStateBefore(definition, id, beforeId))}
          onConnect={(from, to) => {
            const result = connect(definition, from, to)
            setDefinition(result.definition)
            if (result.actionId) notify('Connected. Click the new action to rename it.')
          }}
          onConnectToNew={(from) => {
            const result = connectToNew(definition, from)
            setDefinition(result.definition)
            edit(result.id)
          }}
          onAddAction={(stateId) => {
            const result = addAction(definition, stateId, { kind: 'move' })
            setDefinition(result.definition)
            edit(stateId, result.actionId)
          }}
        />
      ) : (
        <TreePreview definition={definition} />
      )}

      <History history={loaded.history} publishedVersion={loaded.published.version} onMove={moveCases} moving={busy === 'move'} />

      <StateDrawer
        definition={definition}
        stateId={editing?.stateId}
        focusActionId={editing?.actionId}
        errors={validation.errors.filter((entry) => entry.stateId && entry.stateId === editing?.stateId)}
        documentKinds={documentKinds || []}
        onChange={setDefinition}
        onClose={() => setEditing(null)}
        onFocusAction={(actionId) => setEditing((prev) => ({ ...prev, actionId }))}
      />
      <ChecklistDialog open={checklistOpen} onOpenChange={setChecklistOpen} checklist={definition.checklist || []} onSave={(items) => setDefinition(changeChecklist(definition, items))} />
    </div>
  )
}
