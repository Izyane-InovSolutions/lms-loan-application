/* eslint-disable react/prop-types */
import React, { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, GripVertical, PencilLine } from 'lucide-react'

import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { ACTION_KINDS, STATE_TYPES, stateById } from '@/config/workflow'
import { listSteps } from './editing'

/*
 * The List view: the workflow's steps top to bottom, the way a case goes through them.
 * Dragging a step (or its arrows) moves it and reconnects the steps around it; the switch
 * turns a step off, so cases pass straight through it, without losing its setup. The Flow
 * view does the rest: branches, returns, and connecting any state to any other.
 */

const STEP_DRAG = 'application/x-workflow-step'

const TONES = {
  forward: 'text-success',
  neutral: 'text-muted-foreground',
  danger: 'text-destructive',
}

const TYPE_BADGES = {
  work: 'bg-primary/10 text-primary',
  offer: 'bg-warning/20 text-foreground',
  final: 'bg-foreground text-background',
}

function EnabledSwitch({ label, enabled, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? `Disable ${label}` : `Enable ${label}`}
      title={enabled ? 'On: click to turn off' : 'Off: click to turn on'}
      onClick={() => onToggle(!enabled)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        enabled ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  )
}

/** Where a step sends cases, as short "label → target" lines. */
function Links({ definition, state }) {
  const links = [
    ...(state.type === 'offer' ? [{ key: 'accept', label: 'Customer accepts', to: state.offer?.onAccept, tone: 'forward' }] : []),
    ...(state.actions || []).map((action) => ({ key: action.id, label: action.label, to: action.to, tone: ACTION_KINDS[action.kind]?.tone || 'neutral' })),
  ]
  if (!links.length) return <span className="text-muted-foreground">No actions yet</span>
  return links.map((link) => {
    const target = stateById(definition, link.to)?.label
    return (
      <span key={link.key} className={cn('inline-flex items-center gap-1', TONES[link.tone])}>
        {link.label}
        {/* "Send to Underwriting" already says where it goes. */}
        {target && link.label.endsWith(target) ? null : (
          <>
            <ArrowRight className="size-3" aria-hidden="true" />
            {target || 'Choose…'}
          </>
        )}
      </span>
    )
  })
}

function StepRow({ definition, state, index, count, errorCount, dropMark, onEdit, onToggle, onMoveUp, onMoveDown, onDragStart, onDragEnd, onDragOver }) {
  const off = Boolean(state.disabled)
  const passTo = off ? stateById(definition, (state.actions || []).find((action) => action.kind === 'move')?.to) : null
  return (
    <li
      aria-label={state.label}
      onDragOver={onDragOver}
      className={cn(
        'relative flex items-center gap-3 rounded-lg border bg-card px-3 py-3 shadow-sm sm:gap-4 sm:px-4',
        errorCount > 0 && 'border-destructive/50',
        dropMark === 'before' && 'before:absolute before:-top-[7px] before:inset-x-0 before:h-0.5 before:rounded before:bg-primary',
        dropMark === 'after' && 'after:absolute after:-bottom-[7px] after:inset-x-0 after:h-0.5 after:rounded after:bg-primary'
      )}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="-my-1 inline-flex cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to move"
        aria-hidden="true"
      >
        <GripVertical className="size-4" />
      </span>
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums', off ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>{index + 1}</span>

      <div className={cn('min-w-0 flex-1 space-y-1', off && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn('min-w-0 truncate text-sm font-semibold text-foreground', off && 'line-through decoration-muted-foreground/60')}>{state.label || 'Untitled state'}</h3>
          <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', TYPE_BADGES[state.type])}>{STATE_TYPES[state.type]?.label}</span>
          {definition.start === state.id ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Applications start here</span> : null}
          {errorCount ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">{errorCount === 1 ? '1 problem' : `${errorCount} problems`}</span> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">Roles: {state.roles?.length ? state.roles.map(roleLabel).join(', ') : 'All'}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {off ? (
            <span className="text-muted-foreground">{passTo ? `Off: cases pass straight through to “${passTo.label}”` : 'Off, but cases can’t pass it yet: it needs one Move action'}</span>
          ) : (
            <Links definition={definition} state={state} />
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={index === 0} onClick={onMoveUp} aria-label={`Move ${state.label} up`}>
          <ChevronUp className="size-4" />
        </button>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" disabled={index === count - 1} onClick={onMoveDown} aria-label={`Move ${state.label} down`}>
          <ChevronDown className="size-4" />
        </button>
        <span className="mx-1.5">
          <EnabledSwitch label={state.label} enabled={!off} onToggle={onToggle} />
        </span>
        <button type="button" onClick={onEdit} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${state.label}`}>
          <PencilLine className="size-4" />
        </button>
      </div>
    </li>
  )
}

export function StepList({ definition, errorsByState, onEdit, onMove, onToggle }) {
  const [drop, setDrop] = useState(null)
  const steps = listSteps(definition)
  const ends = definition.states.filter((state) => state.type === 'final')

  const dropTarget = (index, position) => (position === 'before' ? steps[index].id : steps[index + 1]?.id || null)
  const finish = (event) => {
    event.preventDefault()
    const moving = event.dataTransfer.getData(STEP_DRAG)
    if (moving && drop) onMove(moving, drop.beforeId)
    setDrop(null)
  }

  return (
    <div className="space-y-6">
      <section aria-label="Steps" className="space-y-3">
        {/* The list takes the drop, so one made in the gap between two steps counts too. */}
        <ol
          className="space-y-3"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(STEP_DRAG)) event.preventDefault()
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null)
          }}
          onDrop={finish}
        >
          {steps.map((state, index) => (
            <StepRow
              key={state.id}
              definition={definition}
              state={state}
              index={index}
              count={steps.length}
              errorCount={errorsByState[state.id] || 0}
              dropMark={drop?.index === index ? drop.position : null}
              onEdit={() => onEdit(state.id)}
              onToggle={(enabled) => onToggle(state.id, enabled)}
              onMoveUp={() => onMove(state.id, steps[index - 1].id)}
              onMoveDown={() => onMove(state.id, steps[index + 2]?.id || null)}
              onDragStart={(event) => {
                event.dataTransfer.setData(STEP_DRAG, state.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDrop(null)}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(STEP_DRAG)) return
                event.preventDefault()
                const box = event.currentTarget.getBoundingClientRect()
                const position = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
                if (drop?.index !== index || drop?.position !== position) setDrop({ index, position, beforeId: dropTarget(index, position) })
              }}
            />
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          Cases go through the steps from top to bottom. Moving a step reconnects the steps around it; returns, rejections and other branches stay as they are (the Flow view shows them all). A step that’s off is skipped and keeps its setup.
        </p>
      </section>

      <section aria-label="Ends" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where cases end</h3>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {ends.map((state) => (
            <li key={state.id} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{state.label}</span>
              <button type="button" onClick={() => onEdit(state.id)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${state.label}`}>
                <PencilLine className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
