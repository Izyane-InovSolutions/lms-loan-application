/* eslint-disable react/prop-types */
import React, { useState } from 'react'
import { ArrowRight, GripVertical, PencilLine, Plus, UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { ACTION_KINDS, STATE_TYPES, stateById } from '@/config/workflow'

/*
 * The Flow view: one card per state, in the order the admin set. A card's grip drags it
 * to a new place; the + on its edge drags a connection onto another card, or onto empty
 * space to create a connected state. Clicking a card's edit icon or an action opens the
 * state's settings, which can do everything dragging does.
 */

const STATE_DRAG = 'application/x-workflow-state'
const CONNECT_DRAG = 'application/x-workflow-connect'

const TONES = {
  forward: 'border-success/40 bg-success/10 text-success',
  neutral: 'border-border bg-background text-foreground',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const TYPE_BADGES = {
  work: 'bg-primary/10 text-primary',
  offer: 'bg-warning/20 text-foreground',
  final: 'bg-foreground text-background',
}

function ActionChip({ label, target, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-center justify-between gap-3 rounded-full border px-4 py-2 text-left text-sm font-medium transition-colors hover:brightness-95', TONES[tone])}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex min-w-0 shrink items-center gap-1.5 font-normal">
        <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{target}</span>
      </span>
    </button>
  )
}

function StateCard({ definition, state, isStart, errorCount, onEdit, onEditAction, onReorder, onConnect, onAddAction, dragging, setDragging }) {
  const [over, setOver] = useState(false)
  const actions = state.actions || []
  const roles = state.roles || []

  const accepts = (event) => event.dataTransfer.types.includes(STATE_DRAG) || event.dataTransfer.types.includes(CONNECT_DRAG)
  const onDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    const moving = event.dataTransfer.getData(STATE_DRAG)
    const from = event.dataTransfer.getData(CONNECT_DRAG)
    if (moving) onReorder(moving, state.id)
    else if (from) onConnect(from, state.id)
    setDragging(null)
  }

  return (
    <article
      aria-label={state.label}
      onDragOver={(event) => {
        if (!accepts(event)) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col rounded-xl border bg-card shadow-sm transition-shadow',
        state.type !== 'final' && 'min-h-[15rem]',
        over && (dragging === 'connect' ? 'ring-2 ring-success/60' : 'ring-2 ring-primary/50'),
        errorCount > 0 && 'border-destructive/50'
      )}
    >
      <div className="border-b px-5 pb-3 pt-3">
        <span
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(STATE_DRAG, state.id)
            event.dataTransfer.effectAllowed = 'move'
            setDragging('state')
          }}
          onDragEnd={() => setDragging(null)}
          className="-m-1 inline-flex cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
          title="Drag to reorder"
          aria-hidden="true"
        >
          <GripVertical className="size-4" />
        </span>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate text-base font-semibold text-foreground" title={state.label}>
            {state.label || 'Untitled state'}
          </h3>
          <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-medium', TYPE_BADGES[state.type])}>{STATE_TYPES[state.type]?.label}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{state.type === 'final' ? 'All' : roles.length ? roles.map(roleLabel).join(', ') : 'Anyone allowed'}</span>
          </span>
          <button type="button" onClick={onEdit} className="rounded p-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit ${state.label}`}>
            <PencilLine className="size-4" />
          </button>
        </div>
        {isStart || errorCount ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {isStart ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Applications start here</span> : null}
            {errorCount ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">{errorCount === 1 ? '1 problem' : `${errorCount} problems`}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-5 py-4">
        {state.type === 'final' ? <p className="text-sm italic text-muted-foreground">End of workflow</p> : null}
        {state.type === 'offer' ? (
          <ActionChip label="Customer accepts" target={stateById(definition, state.offer?.onAccept)?.label || 'Choose…'} tone="forward" onClick={onEdit} />
        ) : null}
        {actions.map((action) => (
          <ActionChip
            key={action.id}
            label={action.label}
            target={stateById(definition, action.to)?.label || 'Choose…'}
            tone={ACTION_KINDS[action.kind]?.tone || 'neutral'}
            onClick={() => onEditAction(action.id)}
          />
        ))}
        {state.type === 'work' && !actions.length ? <p className="text-sm text-muted-foreground">No actions yet: drag the + onto the next state.</p> : null}
      </div>

      {state.type !== 'final' ? (
        <div className="absolute -right-3 top-[7.6rem] flex items-center">
          {/* A span, not a <button>: browsers differ on dragging buttons. Click or Enter adds an action. */}
          <span
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(CONNECT_DRAG, state.id)
              event.dataTransfer.effectAllowed = 'link'
              setDragging('connect')
            }}
            onDragEnd={() => setDragging(null)}
            onClick={onAddAction}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onAddAction()
              }
            }}
            className="grid size-7 cursor-grab place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            aria-label={`Add an action to ${state.label}`}
            title="Drag onto a state to connect, or click to add an action"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </span>
        </div>
      ) : null}
    </article>
  )
}

export function FlowBoard({ definition, errorsByState, onEdit, onReorder, onConnect, onConnectToNew, onAddAction }) {
  const [dragging, setDragging] = useState(null)
  const [overEmpty, setOverEmpty] = useState(false)

  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(STATE_DRAG) && !event.dataTransfer.types.includes(CONNECT_DRAG)) return
        event.preventDefault()
        setOverEmpty(event.target === event.currentTarget)
      }}
      onDragLeave={() => setOverEmpty(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOverEmpty(false)
        const moving = event.dataTransfer.getData(STATE_DRAG)
        const from = event.dataTransfer.getData(CONNECT_DRAG)
        // Only drops on the board itself reach here (a card handles its own). A state
        // dropped in a gap stays put; a connection dropped there makes a new state.
        if (from && !moving) onConnectToNew(from)
        setDragging(null)
      }}
      className={cn('grid grid-cols-1 gap-x-10 gap-y-6 rounded-xl p-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4', overEmpty && 'bg-success/5 ring-2 ring-dashed ring-success/40')}
    >
      {definition.states.map((state) => (
        <StateCard
          key={state.id}
          definition={definition}
          state={state}
          isStart={definition.start === state.id}
          errorCount={errorsByState[state.id] || 0}
          onEdit={() => onEdit(state.id)}
          onEditAction={(actionId) => onEdit(state.id, actionId)}
          onReorder={onReorder}
          onConnect={onConnect}
          onAddAction={() => onAddAction(state.id)}
          dragging={dragging}
          setDragging={setDragging}
        />
      ))}
    </div>
  )
}
