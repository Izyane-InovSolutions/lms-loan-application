import React from 'react'
import { Plus, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ELIGIBILITY_FACTS, ELIGIBILITY_OPERATORS, describeEligibilityRule } from '@/config/productEligibility'
import { Panel } from '../components'

/*
 * Policy rules → Product eligibility: the requirements an applicant must meet, from their
 * documents and answers, to qualify for a loan product (src/config/productEligibility.js).
 * "We'll match you" applicants are offered only the products they meet; on applications from
 * the website finder an unmet rule is shown to the officer. Saved and published with the
 * credit rules, as one version.
 */

let seed = 0
const blankRule = () => ({ id: `e${Date.now().toString(36)}${(seed += 1)}`, fact: 'net_monthly_pay', operator: 'gte', value: 0, message: '', products: [], loanTypes: [], enabled: true })

export function EligibilityRules({ rules, canEdit, products, loanTypes, onChange }) {
  const update = (index, changes) => onChange(rules.map((rule, position) => (position === index ? { ...rule, ...changes } : rule)))
  const productName = (id) => products.find((product) => product.id === id)?.name || id
  const typeName = (key) => loanTypes.find((type) => type.key === key)?.label || key

  return (
    <Panel
      title={`Product eligibility (${rules.length})`}
      description="What an applicant must meet, from their documents and answers, to qualify for a product. Applicants who ask us to match them are offered only the products they meet; on applications from the website’s loan finder, a rule not met is flagged for the officer. A rule over a figure that couldn’t be read is skipped, not failed."
    >
      {rules.length ? (
        <ul className="divide-y rounded-lg border">
          {rules.map((rule, index) => {
            const scoped = rule.products.length || rule.loanTypes.length
            return (
              <li key={rule.id} className={cn('space-y-3 p-3', rule.enabled === false && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-muted-foreground">Applies to</span>
                  {!scoped ? <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">Every product</span> : null}
                  {rule.loanTypes.map((key) => (
                    <Chip key={`t:${key}`} label={`All ${typeName(key).toLowerCase()}`} onRemove={canEdit ? () => update(index, { loanTypes: rule.loanTypes.filter((entry) => entry !== key) }) : null} />
                  ))}
                  {rule.products.map((id) => (
                    <Chip key={`p:${id}`} label={productName(id)} onRemove={canEdit ? () => update(index, { products: rule.products.filter((entry) => entry !== id) }) : null} />
                  ))}
                  {canEdit ? (
                    <Select
                      aria-label="Add a loan type or product this rule applies to"
                      value=""
                      onChange={(event) => {
                        const [kind, key] = event.target.value.split(':')
                        if (kind === 'type') update(index, { loanTypes: [...rule.loanTypes, key] })
                        if (kind === 'product') update(index, { products: [...rule.products, key] })
                      }}
                      className="h-7 w-48 text-xs"
                    >
                      <option value="">{scoped ? 'Add another…' : 'Only some…'}</option>
                      <optgroup label="Loan types">
                        {loanTypes
                          .filter((type) => !rule.loanTypes.includes(type.key))
                          .map((type) => (
                            <option key={type.key} value={`type:${type.key}`}>
                              All {type.label.toLowerCase()}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Products">
                        {products
                          .filter((product) => !rule.products.includes(product.id))
                          .map((product) => (
                            <option key={product.id} value={`product:${product.id}`}>
                              {product.name}
                              {product.enabled ? '' : ' (off)'}
                            </option>
                          ))}
                      </optgroup>
                    </Select>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_8rem_minmax(0,1.6fr)_auto] lg:items-center">
                    <Select aria-label="What it checks" value={rule.fact} onChange={(event) => update(index, { fact: event.target.value })} className="h-9 text-sm">
                      {Object.entries(ELIGIBILITY_FACTS).map(([key, fact]) => (
                        <option key={key} value={key}>
                          {fact.label}
                          {fact.loanTypes.length === 1 ? ` (${fact.loanTypes[0]} form)` : ''}
                        </option>
                      ))}
                    </Select>
                    <Select aria-label="Comparison" value={rule.operator} onChange={(event) => update(index, { operator: event.target.value })} className="h-9 text-sm">
                      {Object.entries(ELIGIBILITY_OPERATORS).map(([key, operator]) => (
                        <option key={key} value={key}>
                          must {operator.label.replace(/^is /, 'be ')}
                        </option>
                      ))}
                    </Select>
                    <Input aria-label="Value" type="number" step="any" value={rule.value} onChange={(event) => update(index, { value: event.target.value === '' ? '' : Number(event.target.value) })} className="h-9 text-sm" />
                    <Input
                      aria-label="What the applicant is told when they don't meet it"
                      placeholder="What the applicant is told, e.g. You need net pay of at least K5,000."
                      value={rule.message}
                      onChange={(event) => update(index, { message: event.target.value })}
                      className="h-9 text-sm"
                    />
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                        <input type="checkbox" checked={rule.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} className="size-4 accent-primary" />
                        On
                      </label>
                      <Button type="button" variant="ghost" size="icon" className="size-9 text-destructive" aria-label="Delete this rule" onClick={() => onChange(rules.filter((_, position) => position !== index))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground">
                    {describeEligibilityRule(rule)} <span className="text-muted-foreground">— “{rule.message}”</span>
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No eligibility rules: every product is open to everyone who can afford it.</p>
      )}
      {canEdit ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => onChange([...rules, blankRule()])}>
          <Plus />
          Add an eligibility rule
        </Button>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Affordability is checked too, on every product: the budget and minimum income set under Settings → Loan products. Figures known only after the amount is chosen (the instalment, age at the end of the loan) are left to the credit rules.
      </p>
    </Panel>
  )
}

function Chip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 font-medium text-primary">
      {label}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="rounded-full p-0.5 hover:bg-primary/15">
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}
