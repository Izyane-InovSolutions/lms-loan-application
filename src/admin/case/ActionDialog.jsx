import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Field, FormError } from '../components'

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * A dialog for one workflow action, built from a field list:
 *   { name, label, type: 'textarea' | 'number' | 'select' | 'choice' | 'checkboxes', options?, hint?, showIf?(values) }
 * `checkboxes` keeps the picked options' values as an array.
 * `choice` renders large radio cards.
 * `outcomes` ({ name, options: [{ value, label, tone }] }) ends the dialog in one button per
 * option instead of one submit (Decline / Approve): each submits with `name` set to its value,
 * and is greyed out, saying why on hover, while `blocked` holds it back.
 * `before(values)` renders beside the fields, in a wider dialog (above them on a phone);
 * `blocked(values)` returns why it can't be submitted yet (shown, and the button
 * disabled), or null.
 */
export function ActionDialog({ open, onOpenChange, title, description, fields, initial = {}, submitLabel, tone = 'default', onSubmit, before, blocked, outcomes }) {
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

  // `extra` is the outcome picked, when the dialog ends in outcome buttons.
  const submit = async (extra = {}) => {
    setBusy(extra[outcomes?.name] || true)
    setError('')
    try {
      await onSubmit({ ...values, ...extra })
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    // With outcome buttons, only a button decides; Enter in a field doesn't pick one.
    if (!outcomes) submit()
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
                            return (
                              <label
                                key={option.value}
                                className={cn(
                                  // The ring only for the keyboard: a click shouldn't outline the picked option.
                                  'flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                                  picked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40'
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
                                <span className="font-medium text-foreground">{option.label}</span>
                                {option.hint ? <span className="mt-0.5 text-xs text-muted-foreground">{option.hint}</span> : null}
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>
                    )
                  }
                  if (field.type === 'checkboxes') {
                    const picked = values[field.name] || []
                    return (
                      <fieldset key={field.name} className="space-y-2">
                        <legend className="text-sm font-medium text-foreground">{field.label}</legend>
                        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {field.options.map((option) => (
                            <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
                              <input
                                type="checkbox"
                                checked={picked.includes(option.value)}
                                onChange={(event) => set(field.name, event.target.checked ? [...picked, option.value] : picked.filter((value) => value !== option.value))}
                                className="size-4 accent-primary"
                              />
                              {option.label}
                            </label>
                          ))}
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
          {reason && !outcomes ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {outcomes ? (
              outcomes.options.map((option) => {
                const held = blocked ? blocked({ ...values, [outcomes.name]: option.value }) : null
                const button = (
                  <Button
                    type="button"
                    // The approving outcome is the filled one; the others are outlined, a decline in red.
                    variant={option.tone === 'primary' ? 'default' : 'outline'}
                    className={cn(option.tone === 'destructive' && 'text-destructive hover:text-destructive')}
                    disabled={Boolean(busy) || Boolean(held)}
                    onClick={() => submit({ [outcomes.name]: option.value })}
                  >
                    {busy === option.value ? <Loader2 className="animate-spin" /> : null}
                    {option.label}
                  </Button>
                )
                return held ? (
                  <span key={option.value} title={held} className="inline-flex cursor-not-allowed">
                    {button}
                    <span className="sr-only">{held}</span>
                  </span>
                ) : (
                  <React.Fragment key={option.value}>{button}</React.Fragment>
                )
              })
            ) : (
              <Button type="submit" variant={buttonTone === 'destructive' ? 'destructive' : 'default'} disabled={Boolean(busy) || Boolean(reason)}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {label}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
