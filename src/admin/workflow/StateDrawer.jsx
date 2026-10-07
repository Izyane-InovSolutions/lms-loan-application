/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react'
import { Flag, Plus, Power, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { registeredRoles } from '@/config/roles'
import { ACTION_KINDS, STATE_TYPES, SYSTEM_FINALS, isOfferDocument, missingForState, needsApproval, stateById, stateDocuments } from '@/config/workflow'
import { addAction, changeAction, changeState, removeAction, removeState, setStateEnabled } from './editing'

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

/**
 * The documents the applicant is sent on entering the state, each optionally required
 * before the case moves on. With no list of its own, an offer state sends the offer letter
 * and the state after acceptance the facility letter (stateDocuments); ticking anything
 * here gives the state its own list.
 */
function StateDocuments({ state, definition, documentKinds, onChange }) {
  const chosen = stateDocuments(state, definition)
  const entryFor = (key) => chosen.find((entry) => entry.kind === key)
  // Retired kinds only while this state still sends one, so it can be taken off.
  const kinds = documentKinds.filter((kind) => !kind.retired || entryFor(kind.key))
  const set = (key, next) => {
    const without = chosen.filter((entry) => entry.kind !== key)
    onChange({ documents: next ? [...without, next] : without })
  }
  return (
    <Section title="Documents sent at this stage">
      <p className="text-xs text-muted-foreground">
        Made from Settings → Documents when a case arrives here, and emailed to the applicant in one message with the PDFs attached. They sign online, or print, sign and upload a copy.
        {state.type === 'offer' ? ' The offer letter is signed when the customer accepts; the facility letter follows once they have.' : ''}
      </p>
      <ul className="space-y-2">
        {kinds.map((kind) => {
          const entry = entryFor(kind.key)
          // The offer letter belongs to the offer; the built-in documents are made from the approved terms.
          const note = isOfferDocument(kind.key) ? (state.type !== 'offer' ? ' Signed by accepting the offer, so it belongs on the offer stage.' : '') : needsApproval(kind.key) ? ' Only after approval.' : ''
          return (
            <li key={kind.key} className="rounded-md border px-3 py-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                  checked={Boolean(entry)}
                  onChange={(event) => set(kind.key, event.target.checked ? { kind: kind.key, required: false } : null)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{kind.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {kind.retired ? 'Retired: take it off this stage.' : kind.requiresSignature ? 'The applicant signs it.' : 'For the applicant to read and keep.'}
                    {note}
                  </span>
                </span>
              </label>
              {/* The offer waits on the customer's acceptance, not on staff moving it on. */}
              {entry && state.type !== 'offer' ? (
                <label className="ml-6 mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" className="size-3.5 accent-[hsl(var(--primary))]" checked={Boolean(entry.required)} onChange={(event) => set(kind.key, { ...entry, required: event.target.checked })} />
                  Required to move on: {kind.requiresSignature ? 'signed, or a signed copy received' : 'marked received'} before the case leaves this stage
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>
      {!kinds.length ? <p className="text-sm text-muted-foreground">No documents yet. Add them in Settings → Documents.</p> : null}
    </Section>
  )
}

export function StateDrawer({ definition, stateId, focusActionId, errors, documentKinds = [], onChange, onClose, onFocusAction }) {
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
                    {roles.map((role) => {
                      const ticked = (state.roles || []).includes(role.key)
                      // A role that can't take this state's actions can't work on it. One
                      // already ticked stays clickable, so it can be unticked.
                      const gaps = missingForState(role, state)
                      const unable = gaps.length > 0
                      return (
                        <label key={role.key} className={`flex items-start gap-2 text-sm ${unable && !ticked ? 'text-muted-foreground' : ''}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                            checked={ticked}
                            disabled={unable && !ticked}
                            onChange={() => update({ roles: toggleIn(state.roles || [], role.key) })}
                          />
                          <span>
                            {role.label}
                            {unable ? (
                              <span className={`block text-xs ${ticked ? 'text-destructive' : ''}`}>
                                Can’t {gaps.flatMap((gap) => gap.actions).join(' or ').toLowerCase()} (lacks {gaps.map((gap) => gap.label.toLowerCase()).join(', ')})
                              </span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(state.roles || []).length
                      ? 'Cases here wait in these roles’ queue, for people whose role also allows the action. Administrators can always act.'
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

                <StateDocuments state={state} definition={definition} documentKinds={documentKinds} onChange={update} />

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
                  {state.disabled ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Off: cases pass straight through it by its Move action. Its setup is kept for when you turn it back on.</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onChange(setStateEnabled(definition, state.id, Boolean(state.disabled)))}>
                      <Power />
                      {state.disabled ? 'Turn this state on' : 'Turn this state off'}
                    </Button>
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
