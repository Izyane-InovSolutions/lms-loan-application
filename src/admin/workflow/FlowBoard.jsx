/* eslint-disable react/prop-types */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, GripVertical, PencilLine, Plus, UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { ACTION_KINDS, STATE_TYPES, stateById } from '@/config/workflow'

/*
 * The Flow view: one card per state, in the order the admin set. A card's grip drags it
 * to a new place; the + on its edge drags a connection onto another card, or onto empty
 * space to create a connected state. Clicking a card's edit icon or an action opens the
 * state's settings, which can do everything dragging does.
 *
 * Lines behind the cards show where each action leads between working states: solid for
 * moving forward, dashed for sending back. Hovering a card brings its lines forward.
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

// How each kind of line is drawn: forward moves and send-backs.
const EDGE_STYLES = {
  forward: { stroke: 'stroke-success', marker: 'fill-success', dash: undefined, width: 1.75 },
  back: { stroke: 'stroke-muted-foreground', marker: 'fill-muted-foreground', dash: '6 4', width: 1.5 },
}

const edgeKind = (kind) => (kind === 'return' ? 'back' : 'forward')

// Every connection between working states: one per action (and per offer acceptance).
// Lines into final states are left out; the action chip already names where they end.
function edgesOf(definition) {
  const working = (id) => {
    const state = stateById(definition, id)
    return state && state.type !== 'final'
  }
  const edges = []
  for (const state of definition.states) {
    if (state.type === 'offer' && state.offer?.onAccept) {
      edges.push({ key: `${state.id}:accept`, from: state.id, to: state.offer.onAccept, kind: 'forward' })
    }
    for (const action of state.actions || []) {
      if (action.to) edges.push({ key: `${state.id}:${action.id}`, from: state.id, to: action.to, kind: edgeKind(action.kind) })
    }
  }
  return edges.filter((edge) => edge.from !== edge.to && working(edge.to))
}

/*
 * A curve from the source card's side, level with the action, to the target card's side
 * by its title. Forward lines leave the right edge and enter the left; send-backs leave the
 * left edge and enter the right, so the two directions never share a path.
 */
function edgePath(kind, chip, source, target) {
  const y1 = chip.top + chip.height / 2
  const y2 = target.top + 22
  const back = kind === 'back'
  const x1 = back ? source.left : source.right
  const x2 = back ? target.right : target.left
  const ahead = back ? x2 < x1 : x2 > x1
  const bend = ahead ? Math.max(28, Math.abs(x2 - x1) / 2) : 56
  const c1 = back ? x1 - bend : x1 + bend
  const c2 = back ? x2 + bend : x2 - bend
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`
}

function FlowLines({ edges, paths, hovered }) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible" aria-hidden="true">
      <defs>
        {Object.entries(EDGE_STYLES).map(([kind, style]) => (
          <marker key={kind} id={`flow-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={style.marker} />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => {
        const d = paths[edge.key]
        if (!d) return null
        const style = EDGE_STYLES[edge.kind]
        const lit = hovered && (edge.from === hovered || edge.to === hovered)
        return (
          <path
            key={edge.key}
            d={d}
            fill="none"
            className={cn(style.stroke, 'transition-opacity', hovered && !lit && 'opacity-20')}
            strokeWidth={lit ? style.width + 0.75 : style.width}
            strokeDasharray={style.dash}
            strokeLinecap="round"
            markerEnd={`url(#flow-arrow-${edge.kind})`}
          />
        )
      })}
    </svg>
  )
}

function Legend() {
  const item = (kind, label) => (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="6" aria-hidden="true">
        <line x1="1" y1="3" x2="21" y2="3" className={EDGE_STYLES[kind].stroke} strokeWidth="1.75" strokeDasharray={EDGE_STYLES[kind].dash} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  )
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item('forward', 'Moves forward')}
      {item('back', 'Sends back')}
      <span className="hidden sm:inline">· Hover a card to trace its connections</span>
    </div>
  )
}

const ActionChip = React.forwardRef(function ActionChip({ label, target, tone, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-center justify-between gap-2 rounded-full border px-2.5 py-1 text-left text-xs font-medium transition-colors hover:brightness-95', TONES[tone])}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex min-w-0 shrink items-center gap-1 font-normal">
        <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{target}</span>
      </span>
    </button>
  )
})

function StateCard({ definition, state, isStart, errorCount, onEdit, onEditAction, onReorder, onConnect, onAddAction, dragging, setDragging, register, onHover }) {
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
      ref={register(state.id)}
      aria-label={state.label}
      onMouseEnter={() => onHover(state.id)}
      onMouseLeave={() => onHover(null)}
      onDragOver={(event) => {
        if (!accepts(event)) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'relative z-10 flex flex-col self-start rounded-lg border bg-card shadow-sm transition-shadow',
        over && (dragging === 'connect' ? 'ring-2 ring-success/60' : 'ring-2 ring-primary/50'),
        state.disabled && 'border-dashed',
        errorCount > 0 && 'border-destructive/50'
      )}
    >
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(STATE_DRAG, state.id)
              event.dataTransfer.effectAllowed = 'move'
              setDragging('state')
            }}
            onDragEnd={() => setDragging(null)}
            className="-ml-1 inline-flex shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
            title="Drag to reorder"
            aria-hidden="true"
          >
            <GripVertical className="size-3.5" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={state.label}>
            {state.label || 'Untitled state'}
          </h3>
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', TYPE_BADGES[state.type])}>{STATE_TYPES[state.type]?.label}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{state.type === 'final' ? 'All' : roles.length ? roles.map(roleLabel).join(', ') : 'Anyone allowed'}</span>
          </span>
          <button type="button" onClick={onEdit} className="rounded p-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit ${state.label}`}>
            <PencilLine className="size-3.5" />
          </button>
        </div>
        {isStart || errorCount || state.disabled ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {isStart ? <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">Applications start here</span> : null}
            {state.disabled ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Off: cases pass straight through</span> : null}
            {errorCount ? <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{errorCount === 1 ? '1 problem' : `${errorCount} problems`}</span> : null}
          </div>
        ) : null}
      </div>

      {state.type === 'final' ? null : (
        <div className={cn('flex flex-col gap-1.5 px-3 py-2.5', state.disabled && 'opacity-60')}>
          {state.type === 'offer' ? (
            <ActionChip
              ref={register(`${state.id}:accept`)}
              label="Customer accepts"
              target={stateById(definition, state.offer?.onAccept)?.label || 'Choose…'}
              tone="forward"
              onClick={onEdit}
            />
          ) : null}
          {actions.map((action) => (
            <ActionChip
              key={action.id}
              ref={register(`${state.id}:${action.id}`)}
              label={action.label}
              target={stateById(definition, action.to)?.label || 'Choose…'}
              tone={ACTION_KINDS[action.kind]?.tone || 'neutral'}
              onClick={() => onEditAction(action.id)}
            />
          ))}
          {state.type === 'work' && !actions.length ? <p className="text-xs text-muted-foreground">No actions yet: drag the + onto the next state.</p> : null}
        </div>
      )}

      {state.type !== 'final' ? (
        <div className="absolute -right-3 bottom-2 flex items-center">
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
            className="grid size-6 cursor-grab place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            aria-label={`Add an action to ${state.label}`}
            title="Drag onto a state to connect, or click to add an action"
          >
            <Plus className="size-3" aria-hidden="true" />
          </span>
        </div>
      ) : null}
    </article>
  )
}

export function FlowBoard({ definition, errorsByState, onEdit, onReorder, onConnect, onConnectToNew, onAddAction }) {
  const [dragging, setDragging] = useState(null)
  const [overEmpty, setOverEmpty] = useState(false)
  const [hovered, setHovered] = useState(null)
  const [paths, setPaths] = useState({})
  const boardRef = useRef(null)
  const nodes = useRef(new Map())

  const register = useCallback(
    (key) => (element) => {
      if (element) nodes.current.set(key, element)
      else nodes.current.delete(key)
    },
    []
  )

  const edges = edgesOf(definition)

  // Lines follow the cards, so measure after every layout change: edits, reordering, resizing.
  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return undefined
    const measure = () => {
      const origin = board.getBoundingClientRect()
      const rect = (key) => {
        const box = nodes.current.get(key)?.getBoundingClientRect()
        return box && { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, height: box.height }
      }
      const next = {}
      for (const edge of edgesOf(definition)) {
        const chip = rect(edge.key)
        const source = rect(edge.from)
        const target = rect(edge.to)
        if (chip && source && target) next[edge.key] = edgePath(edge.kind, chip, source, target)
      }
      setPaths(next)
    }
    measure()
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    observer.observe(board)
    for (const element of nodes.current.values()) observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [definition])

  return (
    <div>
      <Legend />
      <div
        ref={boardRef}
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
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 13.5rem), 1fr))' }}
        className={cn('relative grid gap-x-14 gap-y-10 rounded-xl p-2', overEmpty && 'bg-success/5 ring-2 ring-dashed ring-success/40')}
      >
        <FlowLines edges={edges} paths={paths} hovered={hovered} />
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
            register={register}
            onHover={setHovered}
          />
        ))}
      </div>
    </div>
  )
}
