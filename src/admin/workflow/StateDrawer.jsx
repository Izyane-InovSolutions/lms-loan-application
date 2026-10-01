/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react'
import { Flag, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { registeredRoles } from '@/config/roles'
import { ACTION_KINDS, STATE_TYPES, SYSTEM_FINALS, stateById } from '@/config/workflow'
import { addAction, changeAction, changeState, removeAction, removeState } from './editing'

/*
 * Everything about one state, in a side panel: its name, type and roles, what it asks for,
 * and its actions. Anything the board does by dragging can be done here with the keyboard.
 */

const PRODUCTS = { personal: 'Personal loans', business: 'Business loans' }

const KIND_HINTS = {
  move: 'Moves the case on.',
  return: 'Sends the case back to an earlier state, with a reason.',
  recommend: 'Records a recommendation (approve or decline, with terms) for whoever decides.',
  approve: 'The decision: approved terms, within the approver’s limit.',
  reject: 'Declines the application. The applicant is told it was not approved.',
  pay_out: 'Records the payout and ends the case.',
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block font-medium text-foreground">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

const toggleIn = (list, item) => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item])

function ActionEditor({ definition, state, action, onChange, onRemove, highlight }) {
  const ref = useRef(null)
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlight])
  const kind = ACTION_KINDS[action.kind]
  const targets = definition.states.filter((entry) => entry.id !== state.id && (kind?.to ? entry.id === kind.to : entry.type !== 'final'))
  const checklist = definition.checklist || []
  return (
    <li ref={ref} className={`space-y-3 rounded-lg border p-3 ${highlight ? 'ring-2 ring-primary/50' : ''}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Action name" value={action.label} maxLength={60} placeholder="Action name" onChange={(event) => onChange({ label: event.target.value })} />
        <Select aria-label="What it does" value={action.kind} onChange={(event) => onChange({ kind: event.target.value })}>
          {Object.entries(ACTION_KINDS).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">{KIND_HINTS[action.kind]}</p>
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Goes to</span>
        <Select aria-label="Goes to" value={action.to} disabled={Boolean(kind?.to)} onChange={(event) => onChange({ to: event.target.value })}>
          {!action.to ? <option value="">Choose a state…</option> : null}
          {targets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="space-y-2">
        <Toggle
          label="Not whoever recommended it or brought it in"
          hint="Four-eyes: a second person takes this action."
          checked={Boolean(action.options?.fourEyes)}
          onChange={(value) => onChange({ options: { fourEyes: value } })}
        />
        {['move', 'pay_out'].includes(action.kind) ? (
          <Toggle label="Needs a note" checked={Boolean(action.options?.requireNote)} onChange={(value) => onChange({ options: { requireNote: value } })} />
        ) : null}
        {['recommend', 'approve'].includes(action.kind) && checklist.length ? (
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-muted-foreground">Checks ticked first{action.kind === 'recommend' ? ' (to recommend approval)' : ''}</legend>
            {checklist.map((check) => (
              <label key={check.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={(action.options?.checks || []).includes(check.key)}
                  onChange={() => onChange({ options: { checks: toggleIn(action.options?.checks || [], check.key) } })}
                />
                {check.label}
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 />
          Remove action
        </Button>
      </div>
    </li>
  )
}

export function StateDrawer({ definition, stateId, focusActionId, errors, onChange, onClose, onFocusAction }) {
  const state = stateById(definition, stateId)
  const open = Boolean(state)
  const system = state ? Boolean(SYSTEM_FINALS[state.id]) : false
  const roles = registeredRoles()
  const update = (changes) => onChange(changeState(definition, state.id, changes))

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="left-auto right-0 top-0 h-full max-h-screen w-full max-w-xl translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none sm:rounded-l-xl">
        {state ? (
          <>
            <DialogHeader>
              <DialogTitle>{state.label || 'Untitled state'}</DialogTitle>
              <DialogDescription>
                {system ? 'A built-in end. You can rename it; every workflow keeps it.' : 'Changes are part of the draft until you publish.'}
              </DialogDescription>
            </DialogHeader>

            {errors.length ? (
              <ul className="space-y-1 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {errors.map((error, index) => (
                  <li key={index}>{error.message}</li>
                ))}
              </ul>
            ) : null}

            <div className="space-y-4">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground">Name</span>
                <Input value={state.label} maxLength={60} onChange={(event) => update({ label: event.target.value })} />
              </label>
              {!system ? (
                <>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium text-foreground">Type</span>
                    <Select
                      value={state.type}
                      onChange={(event) => update(event.target.value === 'offer' ? { type: 'offer', offer: { onAccept: state.offer?.onAccept || '' }, actions: [] } : { type: event.target.value })}
                    >
                      <option value="work">{STATE_TYPES.work.label}: staff work on it</option>
                      <option value="offer">{STATE_TYPES.offer.label}: waits for the customer to accept</option>
                    </Select>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium text-foreground">What happens here (optional)</span>
                    <Input value={state.description || ''} maxLength={300} onChange={(event) => update({ description: event.target.value })} />
                  </label>
                </>
              ) : null}
            </div>

            {!system ? (
              <>
                <Section title="Who works on it">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {roles.map((role) => (
                      <label key={role.key} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={(state.roles || []).includes(role.key)} onChange={() => update({ roles: toggleIn(state.roles || [], role.key) })} />
                        {role.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(state.roles || []).length
                      ? 'Cases here wait in these roles’ queue. Administrators can always act.'
                      : 'None ticked: anyone whose role allows the action can take it.'}
                  </p>
                </Section>

                <Section title="For which loans">
                  <div className="flex flex-wrap gap-4">
                    {Object.entries(PRODUCTS).map(([product, label]) => (
                      <label key={product} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-[hsl(var(--primary))]"
                          checked={!(state.products || []).length || state.products.includes(product)}
                          onChange={() => {
                            const current = (state.products || []).length ? state.products : Object.keys(PRODUCTS)
                            const next = toggleIn(current, product)
                            update({ products: next.length === Object.keys(PRODUCTS).length ? [] : next })
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Other loans pass straight through, by this state’s Move action.</p>
                </Section>

                {state.type === 'offer' ? (
                  <Section title="When the customer accepts">
                    <Select aria-label="After acceptance" value={state.offer?.onAccept || ''} onChange={(event) => update({ offer: { ...state.offer, onAccept: event.target.value } })}>
                      <option value="">Choose a state…</option>
                      {definition.states
                        .filter((entry) => entry.type === 'work')
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                    </Select>
                    <p className="text-xs text-muted-foreground">An offer not accepted in time lapses to “{stateById(definition, 'expired')?.label}”.</p>
                  </Section>
                ) : null}

                <Section title="Options">
                  <div className="space-y-3">
                    <Toggle label="Staff can ask the applicant for more" hint="Only before the decision. The case waits until they reply." checked={Boolean(state.askApplicant)} onChange={(value) => update({ askApplicant: value })} />
                    <Toggle label="Hand the loan to the LMS when a case arrives" hint="Where an LMS is connected." checked={Boolean(state.handToLms)} onChange={(value) => update({ handToLms: value })} />
                    {state.type === 'work' ? (
                      <Toggle label="Show as a step on the case" hint="Listed under Stages with “Mark as done”, and who did it." checked={Boolean(state.trackProgress)} onChange={(value) => update({ trackProgress: value })} />
                    ) : null}
                  </div>
                  {(definition.checklist || []).length && state.type === 'work' ? (
                    <fieldset className="space-y-1 pt-1">
                      <legend className="text-xs font-medium text-muted-foreground">Checks ticked before the case moves on</legend>
                      {definition.checklist.map((check) => (
                        <label key={check.key} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={(state.requiredChecks || []).includes(check.key)} onChange={() => update({ requiredChecks: toggleIn(state.requiredChecks || [], check.key) })} />
                          {check.label}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </Section>

                {state.type === 'work' ? (
                  <Section title="Actions">
                    <ul className="space-y-3">
                      {(state.actions || []).map((action) => (
                        <ActionEditor
                          key={action.id}
                          definition={definition}
                          state={state}
                          action={action}
                          highlight={action.id === focusActionId}
                          onChange={(changes) => onChange(changeAction(definition, state.id, action.id, changes))}
                          onRemove={() => onChange(removeAction(definition, state.id, action.id))}
                        />
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const added = addAction(definition, state.id, { kind: 'move' })
                        onChange(added.definition)
                        onFocusAction(added.actionId)
                      }}
                    >
                      <Plus />
                      Add an action
                    </Button>
                  </Section>
                ) : null}

                <Section title="This state">
                  <div className="flex flex-wrap gap-2">
                    {state.type === 'work' && definition.start !== state.id ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...definition, start: state.id })}>
                        <Flag />
                        Start applications here
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        onChange(removeState(definition, state.id))
                        onClose()
                      }}
                    >
                      <Trash2 />
                      Delete this state
                    </Button>
                  </div>
                </Section>
              </>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
