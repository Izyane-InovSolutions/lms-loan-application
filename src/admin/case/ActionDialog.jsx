import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Field, FormError } from '../components'

// A choice button in each tone: always, then [not picked, picked].
const CHOICE_BUTTONS = {
  neutral: ['border-input bg-background text-foreground', 'opacity-60 hover:opacity-90', 'ring-2 ring-ring ring-offset-2 ring-offset-background'],
  primary: ['border-primary bg-primary text-primary-foreground', 'opacity-50 hover:opacity-80', 'ring-2 ring-primary ring-offset-2 ring-offset-background'],
  destructive: ['border-destructive bg-destructive text-destructive-foreground', 'opacity-50 hover:opacity-80', 'ring-2 ring-destructive ring-offset-2 ring-offset-background'],
}

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * A dialog for one workflow action, built from a field list:
 *   { name, label, type: 'textarea' | 'number' | 'select' | 'choice', options?, hint?, showIf?(values) }
 * `choice` renders large radio cards; with `buttons: true`, plain buttons instead (approve /
 * decline / send back), filled in each option's `tone` ('primary' or 'destructive').
 * `before(values)` renders beside the fields, in a wider dialog (above them on a phone);
 * `blocked(values)` returns why it can't be submitted yet (shown, and the button
 * disabled), or null.
 */
export function ActionDialog({ open, onOpenChange, title, description, fields, initial = {}, submitLabel, tone = 'default', onSubmit, before, blocked }) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(initial)
      setError('')
      setBusy(false)
    }
  }, [open])

  const set = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(values)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  const label = typeof submitLabel === 'function' ? submitLabel(values) : submitLabel
  const buttonTone = typeof tone === 'function' ? tone(values) : tone
  const reason = blocked ? blocked(values) : null
  const aside = before ? before(values) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={aside ? 'max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto' : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className={cn(aside && 'grid items-start gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
            {aside}
            <div className="space-y-4">
              {fields
                .filter((field) => !field.showIf || field.showIf(values))
                .map((field) => {
                  const id = `action-${field.name}`
                  if (field.type === 'choice') {
                    return (
                      <fieldset key={field.name} className="space-y-2">
                        <legend className="text-sm font-medium text-foreground">{field.label}</legend>
                        <div className={cn('grid gap-2', field.options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                          {field.options.map((option) => {
                            const picked = values[field.name] === option.value
                            const [base, idle, chosen] = CHOICE_BUTTONS[option.tone] || CHOICE_BUTTONS.neutral
                            return (
                              <label
                                key={option.value}
                                className={cn(
                                  'cursor-pointer rounded-lg border text-sm transition focus-within:ring-2 focus-within:ring-ring',
                                  field.buttons
                                    ? cn('flex h-10 items-center justify-center px-4 font-medium shadow-soft', base, picked ? chosen : idle)
                                    : cn('flex flex-col p-3', picked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40')
                                )}
                              >
                                <input
                                  type="radio"
                                  name={field.name}
                                  value={option.value}
                                  checked={values[field.name] === option.value}
                                  onChange={() => set(field.name, option.value)}
                                  className="sr-only"
                                />
                                {field.buttons ? (
                                  option.label
                                ) : (
                                  <>
                                    <span className="font-medium text-foreground">{option.label}</span>
                                    {option.hint ? <span className="mt-0.5 text-xs text-muted-foreground">{option.hint}</span> : null}
                                  </>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>
                    )
                  }
                  return (
                    <Field key={field.name} id={id} label={field.label} hint={field.hint}>
                      {field.type === 'textarea' ? (
                        <textarea id={id} rows={field.rows || 3} className={textareaClass} value={values[field.name] ?? ''} onChange={(event) => set(field.name, event.target.value)} />
                      ) : field.type === 'select' ? (
                        <Select id={id} value={values[field.name] ?? ''} onChange={(event) => set(field.name, event.target.value)}>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          id={id}
                          type={field.type === 'number' ? 'number' : 'text'}
                          inputMode={field.type === 'number' ? 'numeric' : undefined}
                          value={values[field.name] ?? ''}
                          onChange={(event) => set(field.name, event.target.value)}
                        />
                      )}
                    </Field>
                  )
                })}
            </div>
          </div>
          <FormError message={error} />
          {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={buttonTone === 'destructive' ? 'destructive' : 'default'} disabled={busy || Boolean(reason)}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
