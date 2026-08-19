import React from 'react'

import { cn } from '@/lib/utils'

/**
 * A titled group of related fields. Uses a real fieldset/legend so screen readers
 * announce the grouping, and gives long steps a visual rhythm instead of one
 * undifferentiated grid of inputs.
 */
export function FieldGroup({ title, description, icon: Icon, columns = 3, className, children }) {
  const gridColumns = {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-2 xl:grid-cols-3',
    4: 'md:grid-cols-2 xl:grid-cols-4',
  }[columns]

  return (
    <fieldset className={cn('rounded-lg border bg-card p-5 shadow-soft sm:p-6', className)}>
      <legend className="sr-only">{title}</legend>

      <div className="flex items-start gap-3 border-b border-border pb-4">
        {Icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <div className={cn('mt-5 grid gap-5', gridColumns)}>{children}</div>
    </fieldset>
  )
}
