/* eslint-disable react/prop-types */
import React from 'react'
import { CornerUpLeft, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { roleLabel } from '@/config/roles'
import { STATE_TYPES, forwardEdges, stateById } from '@/config/workflow'

/*
 * The Tree preview: the journey from the start state, following the actions that move a
 * case on. Returns and rejections are shown on the state they leave from rather than as
 * branches, and a state reached a second way is pointed to instead of drawn again.
 */

const KIND_NAMES = { move: '', recommend: 'Recommend', approve: 'Approve', pay_out: 'Pay out', accept: 'Customer accepts' }

/**
 * The tree as data, walked once from the start: each state appears where the walk first
 * meets it, and later meetings point back to it. Built before rendering (rendering may
 * run more than once, and must not change what it walks).
 */
const buildTree = (definition, id, via, seen) => {
  const state = stateById(definition, id)
  if (!state) return null
  if (seen.has(id)) return { state, via, repeat: true, children: [] }
  seen.add(id)
  const children = forwardEdges(state)
    .filter((edge) => edge.kind !== 'reject')
    .map((edge) => buildTree(definition, edge.to, edge.kind === 'move' ? (state.actions || []).find((action) => action.id === edge.actionId)?.label : KIND_NAMES[edge.kind], seen))
    .filter(Boolean)
  return { state, via, repeat: false, children }
}

function Node({ definition, node, depth }) {
  const { state, via } = node
  if (node.repeat) {
    return (
      <li className="relative pl-6">
        <span className="absolute left-0 top-3 h-px w-5 bg-border" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {via ? <span className="mr-1.5 text-xs font-medium">{via}</span> : null}→ {state.label} <span className="text-xs">(shown above)</span>
        </p>
      </li>
    )
  }
  const sideways = (state.actions || []).filter((action) => action.kind === 'return' || action.kind === 'reject')
  return (
    <li className={cn('relative', depth > 0 && 'pl-6')}>
      {depth > 0 ? <span className="absolute left-0 top-5 h-px w-5 bg-border" aria-hidden="true" /> : null}
      <div className={cn('inline-flex max-w-full flex-col gap-1 rounded-lg border bg-card px-3.5 py-2.5', state.type === 'final' && 'bg-muted/60', state.disabled && 'border-dashed opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          {via ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">{via}</span> : null}
          <span className="text-sm font-semibold text-foreground">{state.label}</span>
          <span className="text-xs text-muted-foreground">{state.disabled ? 'Off: passed straight through' : STATE_TYPES[state.type]?.label}</span>
        </div>
        {state.type !== 'final' ? (
          <p className="text-xs text-muted-foreground">{state.roles?.length ? state.roles.map(roleLabel).join(', ') : 'Anyone allowed'}</p>
        ) : null}
        {sideways.length ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {sideways.map((action) => (
              <span
                key={action.id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                  action.kind === 'reject' ? 'border-destructive/30 text-destructive' : 'text-muted-foreground'
                )}
              >
                {action.kind === 'reject' ? <X className="size-3" aria-hidden="true" /> : <CornerUpLeft className="size-3" aria-hidden="true" />}
                {action.label} → {stateById(definition, action.to)?.label || '…'}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {node.children.length ? (
        <ul className="relative ml-4 mt-2 space-y-2 border-l pl-0">
          {node.children.map((child, index) => (
            <Node key={`${child.state.id}-${index}`} definition={definition} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Every state the forward actions reach from the start, rejections included. */
const reachable = (definition) => {
  const found = new Set([definition.start])
  const stack = [definition.start]
  while (stack.length) {
    for (const edge of forwardEdges(stateById(definition, stack.pop()))) {
      if (!found.has(edge.to)) {
        found.add(edge.to)
        stack.push(edge.to)
      }
    }
  }
  return found
}

export function TreePreview({ definition }) {
  const start = stateById(definition, definition.start)
  if (!start) return <p className="text-sm text-muted-foreground">Choose the state applications start in to see the tree.</p>
  const reached = reachable(definition)
  const unreached = definition.states.filter((state) => !reached.has(state.id) && !['withdrawn', 'expired'].includes(state.id))
  return (
    <div className="space-y-6 overflow-x-auto rounded-xl border bg-card/40 p-5">
      <ul>
        <Node definition={definition} node={buildTree(definition, start.id, 'Start', new Set())} depth={0} />
      </ul>
      {unreached.length ? (
        <p className="text-sm text-muted-foreground">
          Not reached from the start: {unreached.map((state) => state.label).join(', ')}.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">Withdrawn and Offer expired are always available ends: the customer can withdraw, and an offer lapses on its own.</p>
    </div>
  )
}
