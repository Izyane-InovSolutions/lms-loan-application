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
 *   { name, label, type: 'textarea' | 'number' | 'select' | 'choice', options?, hint?, showIf?(values) }
 * `choice` renders large radio cards (approve / decline / send back).
 */
export function ActionDialog({ open, onOpenChange, title, description, fields, initial = {}, submitLabel, tone = 'default', onSubmit }) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {fields
            .filter((field) => !field.showIf || field.showIf(values))
            .map((field) => {
              const id = `action-${field.name}`
              if (field.type === 'choice') {
                return (
                  <fieldset key={field.name} className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">{field.label}</legend>
                    <div className={cn('grid gap-2', field.options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                      {field.options.map((option) => (
                        <label
                          key={option.value}
                          className={cn(
                            'flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors',
                            values[field.name] === option.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40'
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
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={buttonTone === 'destructive' ? 'destructive' : 'default'} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
