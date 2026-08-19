import React from 'react'
import { AlertCircle } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { fieldId } from '@/lib/fieldId'

/**
 * Label + control + hint + error, with the aria wiring done once.
 *
 * `children` is a render prop so the control receives the generated id and the
 * `aria-invalid` / `aria-describedby` attributes without every call site
 * repeating them.
 */
export function FormField({ name, label, required = false, error, hint, className, children }) {
  const id = fieldId(name)
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid min-w-0 grid-cols-1 content-start gap-2', className)}>
      <Label htmlFor={id} className="flex items-baseline gap-1">
        <span>{label}</span>
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only">(required)</span> : null}
      </Label>

      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
