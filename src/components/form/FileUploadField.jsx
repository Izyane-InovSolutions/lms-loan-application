import React from 'react'
import { AlertCircle, Camera, CheckCircle2, FileText, Loader2, Trash2, UploadCloud } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { fieldId } from '@/lib/fieldId'

const formatBytes = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Derives the human hint from the accept string, mirroring the validators. */
const acceptHint = (accept) =>
  accept?.includes('image') ? 'PDF, JPG or PNG · up to 3 MB' : 'PDF only · up to 4 MB'

/**
 * Document upload control.
 *
 * The native input is kept in the DOM (sr-only) so the browser file dialog, form
 * semantics and programmatic focus from the error summary all still work — the
 * visible card is a label bound to it.
 *
 * `status` is the caller's existing idle | loading | success | error state. Note
 * that nothing is transmitted at this point: files are sent when the application
 * is submitted, so the success wording is "Attached", not "Uploaded".
 */
export function FileUploadField({
  name,
  label,
  file,
  accept = '.pdf',
  required = false,
  error,
  status = 'idle',
  onChange,
  allowCamera = false,
  onUseCamera,
  className,
}) {
  const id = fieldId(name)
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const clear = () => onChange({ target: { files: [], value: '' } })

  const isBusy = status === 'loading'
  const isAttached = Boolean(file) && !error

  return (
    // min-w-0 lets this shrink below the filename's min-content width (grid items
    // default to min-width:auto), and grid-cols-1 gives the inner column a 0 floor.
    // Without both, `truncate` on the filename can never engage and long names
    // push the card past its column.
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

      <div
        className={cn(
          'relative rounded-md border border-dashed bg-background p-3 transition-colors',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          isAttached && 'border-solid border-success/40 bg-success/5',
          error && 'border-destructive bg-destructive/5'
        )}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          onChange={onChange}
          className="sr-only"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hintId}
        />

        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-md',
              isAttached ? 'bg-success/10 text-success' : error ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-muted-foreground'
            )}
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : isAttached ? (
              <FileText className="size-4" aria-hidden="true" />
            ) : (
              <UploadCloud className="size-4" aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {file ? (
              <>
                <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isBusy ? 'Attaching…' : [formatBytes(file.size), isAttached ? 'Attached' : null].filter(Boolean).join(' · ')}
                </p>
              </>
            ) : (
              <>
                <Label htmlFor={id} className="cursor-pointer text-sm font-medium text-primary hover:underline">
                  Choose a file
                </Label>
                <p id={hintId} className="text-xs text-muted-foreground">
                  {acceptHint(accept)}
                </p>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isAttached && !isBusy ? (
              <CheckCircle2 className="mr-1 size-4 text-success" aria-hidden="true" />
            ) : null}

            {allowCamera ? (
              <button
                type="button"
                onClick={onUseCamera}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Camera className="size-3.5" aria-hidden="true" />
                Camera
              </button>
            ) : null}

            {file ? (
              <>
                <Label
                  htmlFor={id}
                  className="cursor-pointer rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-secondary"
                >
                  Replace
                </Label>
                <button
                  type="button"
                  onClick={clear}
                  aria-label={`Remove ${label}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
