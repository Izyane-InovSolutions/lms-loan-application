import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleDot, FileText, Loader2, Plus, Save, Shield, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { APPLICANT_FORMS, DOCUMENT_CATALOGUE, INTEREST_TYPES, LOAN_PURPOSES, LOAN_TYPE_KEY_PATTERN, PRODUCT_ID_PATTERN, buildLoanTypes, buildProducts, liveProducts, describeFee, describeInterest, formatKwacha, priceLoan, productDefaults, purposeOf } from '@/config/loanProducts'
import { INCOME_LABELS, eligibilityFor, productTags } from '@/config/eligibility'
import { GUARANTOR_REQUIREMENTS } from '@/config/guarantors'
import { COLLATERAL_CODE_PATTERN, COLLATERAL_REQUIREMENTS, buildCollateralCatalog, describeRequirement } from '@/config/collateral'
import { api } from '../api'
import { Field, FormError, Panel } from '../components'

/*
 * Settings → Loan products: the products applicants choose from, each on one of the two
 * application forms, with its pricing, the documents it asks for and the collateral it
 * takes; the collateral types (each with its haircut and loan-to-value) products choose
 * from; and the collateral items applicants pick, each of a type. Saved one product at a
 * time (api/_handlers/settings.js validates each), so editing one never resets another.
 */

const textareaClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const slugOf = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

// What a product saves: everything but the fields worked out from it.
const editable = ({ steps, requiredDocuments, ...product }) => product

export function ProductsTab({ settings, notify }) {
  const [section, setSection] = useState('products')
  const [stored, setStored] = useState(settings.products)
  const [loanTypes, setLoanTypes] = useState(() => buildLoanTypes(settings.loanTypes))
  const [catalog, setCatalog] = useState(() => buildCollateralCatalog(settings.collateral))
  const all = useMemo(() => buildProducts(stored), [stored])
  // Deleted products are kept only for their applications: never listed or edited here.
  const products = useMemo(() => liveProducts(all), [all])
  const types = catalog.types

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b" role="tablist" aria-label="Loan products">
        {[
          ['loanTypes', `Loan types (${loanTypes.length})`],
          ['products', `Products (${products.length})`],
          ['collateral', `Collateral types (${types.filter((type) => !type.retired).length})`],
          ['collateralItems', `Collateral items (${catalog.items.filter((item) => !item.retired).length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            onClick={() => setSection(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              section === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'loanTypes' ? <LoanTypes loanTypes={loanTypes} products={products} onSaved={setLoanTypes} notify={notify} /> : null}
      {section === 'products' ? <Products products={products} takenIds={all.map((product) => product.id)} loanTypes={loanTypes} types={types} onSaved={setStored} notify={notify} /> : null}
      {section === 'collateral' ? <CollateralTypes catalog={catalog} onSaved={setCatalog} notify={notify} /> : null}
      {section === 'collateralItems' ? <CollateralItems catalog={catalog} onSaved={setCatalog} notify={notify} /> : null}
    </div>
  )
}

function Products({ products, takenIds, loanTypes, types, onSaved, notify }) {
  const [selectedId, setSelectedId] = useState(products[0]?.id)
  const [adding, setAdding] = useState(false)
  const selected = products.find((product) => product.id === selectedId) || products[0]

  const save = async (product) => {
    const response = await api('/settings/products', { method: 'PUT', body: { [product.id]: editable(product) } })
    onSaved(response.products)
    notify('Product saved')
    return response.products
  }

  const remove = async (product) => {
    const response = await api(`/settings/products/${product.id}`, { method: 'DELETE' })
    onSaved(response.products)
    setSelectedId(null)
    notify(
      response.kept
        ? `${product.name} deleted. ${response.applications} ${response.applications === 1 ? 'application was' : 'applications were'} made under it, so it is kept for ${response.applications === 1 ? 'that one' : 'them'} only.`
        : `${product.name} deleted`
    )
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-2">
        {loanTypes.map((loanType) => (
          <div key={loanType.key} className="space-y-1">
            <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{loanType.label}</p>
            <ul className="space-y-1">
              {products.filter((product) => product.loanType === loanType.key).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(product.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected?.id === product.id ? 'bg-card shadow-sm ring-1 ring-border' : 'hover:bg-card/60'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{product.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {purposeOf(product)?.label || 'General purpose'} · {product.documents.length} documents
                        {product.collateral.requirement !== 'none' ? ` · collateral ${describeRequirement(product).toLowerCase()}` : ''}
                      </span>
                    </span>
                    <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', product.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
                      {product.enabled ? 'Offered' : 'Off'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Add a product
        </Button>
      </div>

      {selected ? <ProductEditor key={selected.id} product={selected} loanTypes={loanTypes} types={types} onSave={save} onDelete={remove} /> : null}

      <AddProductDialog
        loanTypes={loanTypes}
        open={adding}
        onOpenChange={setAdding}
        taken={takenIds}
        onCreate={async (draft) => {
          await save(draft)
          setSelectedId(draft.id)
        }}
      />
    </div>
  )
}

function AddProductDialog({ loanTypes, open, onOpenChange, taken, onCreate }) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [loanTypeKey, setLoanTypeKey] = useState(loanTypes[0]?.key)
  const loanType = loanTypes.find((type) => type.key === loanTypeKey) || loanTypes[0]
  const form = loanType?.form || 'personal'
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setId('')
      setIdEdited(false)
      setLoanTypeKey(loanTypes[0]?.key)
      setPurpose('')
      setError('')
      setBusy(false)
    }
  }, [open, loanTypes])

  const problem = !name.trim()
    ? 'Give the product a name.'
    : !PRODUCT_ID_PATTERN.test(id)
      ? 'The id needs at least 2 characters: lower-case letters, numbers and dashes, starting with a letter.'
      : taken.includes(id)
        ? 'Another product already uses this id.'
        : null

  const create = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Off until the admin has checked its pricing, documents and collateral.
      await onCreate({ ...productDefaults(form), id, name: name.trim(), loanType: loanType.key, purpose: purpose || null, enabled: false })
      onOpenChange(false)
    } catch (createError) {
      setError(createError.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a loan product</DialogTitle>
          <DialogDescription>It starts switched off, with its form’s usual pricing and documents. Adjust them, then switch it on.</DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4" noValidate>
          <Field id="new-product-name" label="Name" hint="As applicants see it, e.g. Civil Servant Loan.">
            <Input
              id="new-product-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (!idEdited) setId(slugOf(event.target.value))
              }}
            />
          </Field>
          <Field id="new-product-id" label="Id" hint="Appears in the application link (/apply/your-id). It can’t be changed later.">
            <Input
              id="new-product-id"
              value={id}
              onChange={(event) => {
                setIdEdited(true)
                setId(slugOf(event.target.value))
              }}
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Loan type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {loanTypes.map((type) => (
                <label key={type.key} className={cn('flex cursor-pointer flex-col rounded-lg border p-3 text-sm', loanType?.key === type.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40')}>
                  <input
                    type="radio"
                    name="new-product-type"
                    value={type.key}
                    checked={loanType?.key === type.key}
                    onChange={() => {
                      setLoanTypeKey(type.key)
                      setPurpose('')
                    }}
                    className="sr-only"
                  />
                  <span className="font-medium text-foreground">{type.label}</span>
                  <span className="mt-0.5 text-xs text-muted-foreground">{APPLICANT_FORMS[type.form].label} application form</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Its type’s form decides the questions asked and which credit rules apply.</p>
          </fieldset>
          <Field id="new-product-purpose" label="What it’s for" hint="Shown to applicants with the product. Change it any time.">
            <Select id="new-product-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)}>
              <option value="">General purpose</option>
              {LOAN_PURPOSES[form].map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <FormError message={error} />
          {problem && (name || id) ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || Boolean(problem)}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Add product
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductEditor({ product, loanTypes, types, onSave, onDelete }) {
  const [deleting, setDeleting] = useState(false)
  const [value, setValue] = useState(product)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setValue(product), [product])
  const set = (changes) => setValue((prev) => ({ ...prev, ...changes }))
  const dirty = JSON.stringify(editable(value)) !== JSON.stringify(editable(product))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave(value)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title={value.name || 'Untitled product'}
        description={`${APPLICANT_FORMS[value.form].label} application form · id “${value.id}”`}
        action={<Toggle id={`${value.id}-enabled`} label="Offered" checked={value.enabled} onChange={(enabled) => set({ enabled })} />}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${value.id}-name`} label="Name">
              <Input id={`${value.id}-name`} value={value.name} onChange={(event) => set({ name: event.target.value })} />
            </Field>
            <Field id={`${value.id}-tagline`} label="Tagline" hint="One line under the name on the website.">
              <Input id={`${value.id}-tagline`} value={value.tagline} onChange={(event) => set({ tagline: event.target.value })} />
            </Field>
          </div>
          <Field id={`${value.id}-description`} label="Description">
            <textarea id={`${value.id}-description`} rows={3} className={textareaClass} value={value.description} onChange={(event) => set({ description: event.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel title="Loan type and eligibility" description="What the loan is for, how it is described, and who automatically qualifies.">
        <EligibilityFields product={value} loanTypes={loanTypes} onChange={set} />
      </Panel>

      <Panel title="Pricing" description="Submitted applications keep the price they were given.">
        <PricingFields id={value.id} pricing={value} onChange={set} />
      </Panel>

      <Panel title="Documents" description="What applicants upload. Each one is checked by the AI as it arrives.">
        <DocumentsEditor product={value} onChange={(documents) => set({ documents })} />
      </Panel>

      <Panel title="Collateral" description="Whether applicants pledge security for this loan, and how much.">
        <CollateralRules id={value.id} product={value} types={types} onChange={(changes) => set({ collateral: { ...value.collateral, ...changes } })} />
      </Panel>

      <Panel title="Guarantors" description="Whether applicants name someone who will repay if they can’t. Up to three; each guarantor’s name, NRC, phone, relationship and address are asked.">
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">Guarantors are</legend>
          {Object.entries(GUARANTOR_REQUIREMENTS).map(([key, entry]) => (
            <label
              key={key}
              className={cn('flex cursor-pointer flex-col rounded-lg border p-3 text-sm', (value.guarantors?.requirement || 'none') === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40')}
            >
              <input type="radio" name={`${value.id}-guarantors`} value={key} checked={(value.guarantors?.requirement || 'none') === key} onChange={() => set({ guarantors: { requirement: key } })} className="sr-only" />
              <span className="font-medium text-foreground">{entry.label}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{entry.hint}</span>
            </label>
          ))}
        </fieldset>
      </Panel>

      <Panel title="Delete this product" description="Applicants can no longer choose it. Applications already made under it keep it, so they still read as they did.">
        <Button type="button" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleting(true)}>
          <Trash2 />
          Delete {product.name}
        </Button>
      </Panel>
      <DeleteProductDialog product={product} open={deleting} onOpenChange={setDeleting} onDelete={onDelete} />

      <SaveCard
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={() => setValue(product)}
        note="Saved changes apply to new applications straight away. Submitted applications keep the terms they were given."
      />
    </div>
  )
}

/** Confirms deleting a product; says why if it can't be (the last one switched on). */
function DeleteProductDialog({ product, open, onOpenChange, onDelete }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setBusy(false)
      setError('')
    }
  }, [open])
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onDelete(product)
      onOpenChange(false)
    } catch (deleteError) {
      setError(deleteError.message)
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {product.name}?</DialogTitle>
          <DialogDescription>
            It disappears from the website and from this list, and can’t be brought back. If applications were made under it, it is kept for them only, so their documents, pricing and name still show.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A product's purpose, interest type and eligibility (src/config/eligibility.js), with its
 * classification worked out from its settings and a worked example of who qualifies.
 */
function EligibilityFields({ product, loanTypes, onChange }) {
  const words = INCOME_LABELS[product.form]
  const rules = product.eligibility
  const setRule = (changes) => onChange({ eligibility: { ...rules, ...changes } })
  const [example, setExample] = useState(product.form === 'personal' ? 10000 : 50000)
  // The editor holds what is typed; the calculation needs numbers.
  const priced = { ...product, interestRate: Number(product.interestRate), facilityFee: Number(product.facilityFee), minAmount: Number(product.minAmount), maxAmount: Number(product.maxAmount), maxTenure: Number(product.maxTenure), eligibility: { minIncome: null, repaymentShare: Number(rules.repaymentShare) || 0 } }
  const result = eligibilityFor(priced, { income: example })
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${product.id}-loan-type`} label="Loan type" hint={`Types using the ${APPLICANT_FORMS[product.form].label.toLowerCase()} form.`}>
          <Select id={`${product.id}-loan-type`} value={product.loanType} onChange={(event) => onChange({ loanType: event.target.value })}>
            {loanTypes
              .filter((type) => type.form === product.form)
              .map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field id={`${product.id}-purpose`} label="What it’s for">
          <Select id={`${product.id}-purpose`} value={product.purpose || ''} onChange={(event) => onChange({ purpose: event.target.value || null })}>
            <option value="">General purpose</option>
            {LOAN_PURPOSES[product.form].map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${product.id}-interest-type`} label="Interest">
          <Select id={`${product.id}-interest-type`} value={product.interestType || 'fixed'} onChange={(event) => onChange({ interestType: event.target.value })}>
            {Object.entries(INTEREST_TYPES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Shown as
        {productTags(priced).map((tag) => (
          <span key={tag} className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
            {tag}
          </span>
        ))}
        <span>(from its collateral, longest tenure and interest).</span>
      </p>
      <p className="text-sm text-muted-foreground">
        Who qualifies for it by {words.short} is set in{' '}
        <a href="/admin/rules" className="font-medium text-primary hover:underline">
          Policy rules
        </a>
        , in the {product.form === 'personal' ? 'Personal' : 'Business'} Policy: a rule such as “{product.form === 'personal' ? 'Net monthly pay' : 'Average monthly bank credits'} is less than K5,000 → not eligible
        for {product.name || 'this loan'}”. Here: how much of it may go to repayments, which sets how much they can borrow.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${product.id}-share`} label="Share of income for repayments (%)" hint={`The most of their ${words.short} all their loan repayments may take, this one included.`}>
          <Input
            id={`${product.id}-share`}
            type="number"
            step="any"
            value={Number((Number(rules.repaymentShare) * 100).toFixed(2))}
            onChange={(event) => setRule({ repaymentShare: Number(event.target.value) / 100 })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-4 text-sm">
        <label htmlFor={`${product.id}-example-income`} className="text-muted-foreground">
          An applicant with {words.short} of K
        </label>
        <Input id={`${product.id}-example-income`} type="number" value={example} onChange={(event) => setExample(Number(event.target.value) || 0)} className="h-8 w-28 text-sm" />
        <span className="text-muted-foreground">and no other loans</span>
        <span className="font-medium text-foreground">
          {result.status === 'eligible'
            ? `could borrow up to ${formatKwacha(result.maxAmount)} (budget ${formatKwacha(result.budget)} a month), if the policy’s net pay bands let them have it.`
            : result.status === 'ineligible'
              ? `couldn’t borrow it: ${result.reason}`
              : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * Stays at the foot of the screen while editing: whether there is anything unsaved, what
 * saving does, and the buttons. A failed save says why here, beside the button.
 */
function SaveCard({ dirty, saving, error, note, onSave, onDiscard }) {
  const Icon = error ? AlertTriangle : dirty ? CircleDot : CheckCircle2
  return (
    <div className="sticky bottom-4 z-10">
      <div
        role="status"
        className={cn(
          'flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg transition-colors sm:flex-row sm:items-center',
          error ? 'border-destructive/50' : dirty ? 'border-warning/50' : 'border-border'
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className={cn('mt-0.5 size-4 shrink-0', error ? 'text-destructive' : dirty ? 'text-warning' : 'text-success')} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{error ? 'Not saved' : dirty ? 'Unsaved changes' : 'All changes saved'}</p>
            <p className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error || note}</p>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
              <Undo2 />
              Discard
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex shrink-0 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
      {label}
      <span className="relative">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
        <span className="block h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

function PricingFields({ id, pricing, onChange }) {
  const example = useMemo(
    () => priceLoan(Number(pricing.exampleAmount), Number(pricing.defaultTenure), { ...pricing, interestRate: Number(pricing.interestRate), facilityFee: Number(pricing.facilityFee) }),
    [pricing]
  )
  const numberField = (key, label, hint) => (
    <Field id={`${id}-${key}`} label={label} hint={hint}>
      <Input id={`${id}-${key}`} type="number" step="any" value={pricing[key]} onChange={(event) => onChange({ [key]: event.target.value })} />
    </Field>
  )
  const percent = pricing.facilityFeeType === 'percent'
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {numberField('minAmount', 'Smallest loan (K)')}
        {numberField('maxAmount', 'Largest loan (K)')}
        {numberField('exampleAmount', 'Example amount (K)', 'Used on the website')}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {numberField('minTenure', 'Shortest (months)')}
        {numberField('maxTenure', 'Longest (months)')}
        {numberField('defaultTenure', 'Starting tenure')}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-rate`} label="Interest rate (%)">
          <Input
            id={`${id}-rate`}
            type="number"
            step="any"
            value={Number((Number(pricing.interestRate) * 100).toFixed(4))}
            onChange={(event) => onChange({ interestRate: Number(event.target.value) / 100 })}
          />
        </Field>
        <Field id={`${id}-basis`} label="Charged">
          <Select id={`${id}-basis`} value={pricing.interestBasis} onChange={(event) => onChange({ interestBasis: event.target.value })}>
            <option value="loan">Once, on the amount borrowed (flat)</option>
            <option value="month">Every month of the tenure</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-fee`} label={percent ? 'Facility fee (%)' : 'Facility fee (K)'}>
          <Input
            id={`${id}-fee`}
            type="number"
            step="any"
            value={percent ? Number((Number(pricing.facilityFee) * 100).toFixed(4)) : pricing.facilityFee}
            onChange={(event) => onChange({ facilityFee: percent ? Number(event.target.value) / 100 : event.target.value })}
          />
        </Field>
        <Field id={`${id}-fee-type`} label="Fee type">
          <Select id={`${id}-fee-type`} value={pricing.facilityFeeType} onChange={(event) => onChange({ facilityFeeType: event.target.value, facilityFee: 0 })}>
            <option value="fixed">A fixed amount</option>
            <option value="percent">A percentage of the amount</option>
          </Select>
        </Field>
      </div>
      <div className="rounded-lg bg-muted/50 p-4 text-sm">
        <p className="font-medium text-foreground">
          {formatKwacha(pricing.exampleAmount)} over {pricing.defaultTenure} months: {formatKwacha(Math.round(example.monthly))} a month
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {describeInterest({ ...pricing, interestRate: Number(pricing.interestRate) })} interest ({formatKwacha(example.interest)}), fee{' '}
          {describeFee({ ...pricing, facilityFee: Number(pricing.facilityFee) })} ({formatKwacha(example.fee)}), total {formatKwacha(example.total)}.
        </p>
      </div>
    </div>
  )
}

const CUSTOM = '__custom__'

function DocumentsEditor({ product, onChange }) {
  const documents = product.documents
  const catalogue = DOCUMENT_CATALOGUE[product.form]
  const unused = catalogue.filter((entry) => !documents.some((document) => document.slot === entry.slot))
  const [adding, setAdding] = useState('')
  const [customName, setCustomName] = useState('')

  const update = (index, changes) => onChange(documents.map((document, position) => (position === index ? { ...document, ...changes } : document)))
  const move = (index, by) => {
    const next = [...documents]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    onChange(next)
  }
  const customSlot = `custom.${slugOf(customName)}`
  const customTaken = documents.some((document) => document.slot === customSlot)

  const add = () => {
    if (adding === CUSTOM) {
      onChange([...documents, { slot: customSlot, label: customName.trim(), docType: 'custom', description: '', required: true }])
      setCustomName('')
    } else {
      const entry = catalogue.find((item) => item.slot === adding)
      onChange([...documents, { slot: entry.slot, label: entry.label, docType: entry.docType, description: entry.description || '', required: true }])
    }
    setAdding('')
  }

  return (
    <div className="space-y-4">
      {documents.length ? (
        <ul className="divide-y rounded-lg border">
          {documents.map((document, index) => {
            const known = catalogue.find((entry) => entry.slot === document.slot)
            return (
              <li key={document.slot} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Input aria-label="Document name" value={document.label} onChange={(event) => update(index, { label: event.target.value })} className="h-9 min-w-[12rem] flex-1 text-sm" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={document.required} onChange={(event) => update(index, { required: event.target.checked })} className="size-4 accent-primary" />
                    Required
                  </label>
                  <div className="flex items-center">
                    <Button type="button" variant="ghost" size="icon" className="size-8" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${document.label} up`}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === documents.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${document.label} down`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => onChange(documents.filter((_, position) => position !== index))}
                      aria-label={`Remove ${document.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <Input
                  aria-label={`What ${document.label} is`}
                  placeholder={known ? 'Hint for applicants (optional)' : 'What it is, for applicants and the AI check, e.g. “A letter from your employer confirming your post.”'}
                  value={document.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground">{known ? `Checked by the AI as: ${known.label}` : 'Your own document: the AI checks it matches the name and description.'}</p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No documents: applicants upload nothing for this product.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field id={`${product.id}-add-document`} label="Add a document">
          <Select id={`${product.id}-add-document`} value={adding} onChange={(event) => setAdding(event.target.value)} className="h-9 min-w-[16rem] text-sm">
            <option value="">Choose…</option>
            {unused.map((entry) => (
              <option key={entry.slot} value={entry.slot}>
                {entry.label}
              </option>
            ))}
            <option value={CUSTOM}>A document of your own…</option>
          </Select>
        </Field>
        {adding === CUSTOM ? (
          <Input
            aria-label="Name of your document"
            placeholder="e.g. Employer confirmation letter"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            className="h-9 w-64 text-sm"
          />
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!adding || (adding === CUSTOM && (customName.trim().length < 3 || customTaken))}>
          <Plus />
          Add
        </Button>
      </div>
      {adding === CUSTOM && customTaken ? <p className="text-xs text-destructive">This product already has a document with that name.</p> : null}
      {product.form === 'business' ? <p className="text-xs text-muted-foreground">Each director’s NRC and passport photo are always asked for on the company form.</p> : null}
    </div>
  )
}

/**
 * The loan types applicants choose first (Personal loans, Business loans, …). Each uses one
 * of the two application forms, chosen when it is added. A type with products can't be
 * deleted: move its products to another type first (on each product, Loan type).
 */
function LoanTypes({ loanTypes, products, onSaved, notify }) {
  const [value, setValue] = useState(loanTypes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ label: '', form: 'personal' })
  useEffect(() => setValue(loanTypes), [loanTypes])
  const dirty = JSON.stringify(value) !== JSON.stringify(loanTypes)
  const update = (key, changes) => setValue((prev) => prev.map((type) => (type.key === key ? { ...type, ...changes } : type)))
  const countOf = (key) => products.filter((product) => product.loanType === key).length
  const newKey = slugOf(draft.label)
  const canAdd = draft.label.trim().length >= 2 && LOAN_TYPE_KEY_PATTERN.test(newKey) && !value.some((type) => type.key === newKey)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await api('/settings/loanTypes', { method: 'PUT', body: { types: value } })
      onSaved(buildLoanTypes(response.loanTypes))
      notify('Loan types saved')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel title="Loan types" description="What applicants choose first, before a product. Each type uses the individual or the company application form, and every product belongs to one type.">
        <ul className="divide-y rounded-lg border">
          {value.map((type) => {
            const count = countOf(type.key)
            const saved = loanTypes.some((entry) => entry.key === type.key)
            return (
              <li key={type.key} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start">
                <div className="space-y-1">
                  <Input aria-label="Loan type name" value={type.label} onChange={(event) => update(type.key, { label: event.target.value })} className="h-9 text-sm" />
                  <p className="text-xs text-muted-foreground">
                    {APPLICANT_FORMS[type.form].label} form · {count} {count === 1 ? 'product' : 'products'}
                    {saved ? '' : ' · new'}
                  </p>
                </div>
                <Input
                  aria-label={`What ${type.label} are`}
                  placeholder="One line for applicants, e.g. For farmers and agricultural co-operatives"
                  value={type.description}
                  onChange={(event) => update(type.key, { description: event.target.value })}
                  className="h-9 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-destructive"
                  disabled={count > 0 || value.length === 1}
                  onClick={() => setValue((prev) => prev.filter((entry) => entry.key !== type.key))}
                  aria-label={`Delete ${type.label}`}
                  title={count > 0 ? `Move its ${count} ${count === 1 ? 'product' : 'products'} to another loan type first (Products → Loan type).` : value.length === 1 ? 'Keep at least one loan type.' : 'Delete this loan type.'}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">A loan type with products can’t be deleted: move them to another type of the same form first.</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field id="new-loan-type" label="Add a loan type">
            <Input id="new-loan-type" placeholder="e.g. Agricultural loans" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="h-9 w-64 text-sm" />
          </Field>
          <Field id="new-loan-type-form" label="Application form">
            <Select id="new-loan-type-form" value={draft.form} onChange={(event) => setDraft({ ...draft, form: event.target.value })} className="h-9 w-48 text-sm">
              {Object.entries(APPLICANT_FORMS).map(([key, entry]) => (
                <option key={key} value={key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            onClick={() => {
              setValue((prev) => [...prev, { key: newKey, label: draft.label.trim(), description: '', form: draft.form }])
              setDraft({ label: '', form: 'personal' })
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">The form can’t be changed once the type is saved: it decides the questions its applicants answer.</p>
      </Panel>
      <SaveCard
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={() => setValue(loanTypes)}
        note="Applicants see the change straight away. A new type shows on the website once one of its products is switched on."
      />
    </div>
  )
}

function CollateralRules({ id, product, types, onChange }) {
  const rules = product.collateral
  const active = types.filter((type) => !type.retired)
  const off = rules.requirement === 'none'
  const byAmount = rules.requirement === 'amount'
  const from = Number(rules.requiredFrom)
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Collateral is</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(COLLATERAL_REQUIREMENTS).map(([key, entry]) => (
            <label
              key={key}
              className={cn('flex cursor-pointer flex-col rounded-lg border p-3 text-sm', rules.requirement === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40')}
            >
              <input type="radio" name="collateral-requirement" value={key} checked={rules.requirement === key} onChange={() => onChange({ requirement: key })} className="sr-only" />
              <span className="font-medium text-foreground">{entry.label}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{entry.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {byAmount ? (
        <Field
          id={`${id}-collateral-from`}
          label="Required from (K)"
          hint={
            from > Number(product.maxAmount)
              ? `Above this product’s largest loan (${formatKwacha(product.maxAmount)}), so no applicant will be asked.`
              : from > 0
                ? `Loans of ${formatKwacha(from)} or more need collateral; smaller ones aren’t asked.`
                : 'The loan amount from which applicants must pledge collateral.'
          }
        >
          <Input
            id={`${id}-collateral-from`}
            type="number"
            step="any"
            className="max-w-[12rem]"
            value={rules.requiredFrom ?? ''}
            onChange={(event) => onChange({ requiredFrom: event.target.value === '' ? null : Number(event.target.value) })}
          />
        </Field>
      ) : null}
      {!off ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Accepted types</legend>
            <p className="text-xs text-muted-foreground">Applicants pick from the items of these types. Tick none to accept every active type.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {active.map((type) => (
                <label key={type.key} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={rules.types.includes(type.key)}
                    onChange={(event) => onChange({ types: event.target.checked ? [...rules.types, type.key] : rules.types.filter((key) => key !== type.key) })}
                    className="size-4 accent-primary"
                  />
                  {type.label}
                </label>
              ))}
            </div>
          </fieldset>
          {rules.requirement !== 'optional' ? (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={Boolean(rules.mustCover)} onChange={(event) => onChange({ mustCover: event.target.checked })} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="font-medium text-foreground">Lending value must cover the loan</span>
                <span className="block text-xs text-muted-foreground">
                  Each item’s lending value is the applicant’s value, less its type’s haircut, times its loan-to-value ratio. Together they must reach the amount borrowed.
                </span>
              </span>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// Haircuts and loan-to-value ratios are kept as fractions (0.3) and shown as percentages (30).
const asPercent = (value) => (value === '' || value === null || value === undefined ? '' : Number((Number(value) * 100).toFixed(2)))
const fromPercent = (value) => (value === '' ? '' : Number(value) / 100)

/** Saves the whole catalog; a type or item that applications use comes back switched off instead of deleted. */
const saveCatalog = async (next, notify, what) => {
  const response = await api('/settings/collateral', { method: 'PUT', body: next })
  const saved = buildCollateralCatalog(response.collateral)
  const kept = [
    ...saved.types.filter((type) => !next.types.some((entry) => entry.key === type.key)).map((type) => type.label),
    ...saved.items.filter((item) => !next.items.some((entry) => entry.code === item.code)).map((item) => item.name),
  ]
  notify(
    kept.length
      ? `Saved. ${kept.join(', ')} ${kept.length === 1 ? 'is' : 'are'} used on applications, so ${kept.length === 1 ? 'it was' : 'they were'} switched off instead of deleted.`
      : `${what} saved`
  )
  return saved
}

function CollateralTypes({ catalog, onSaved, notify }) {
  const [value, setValue] = useState(catalog.types)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ label: '', haircut: '', ltv: '' })
  useEffect(() => setValue(catalog.types), [catalog.types])
  const dirty = JSON.stringify(value) !== JSON.stringify(catalog.types)
  const update = (key, changes) => setValue((prev) => prev.map((type) => (type.key === key ? { ...type, ...changes } : type)))
  const newKey = slugOf(draft.label).replace(/-/g, '_')
  const itemsOf = (key) => catalog.items.filter((item) => item.type === key).length
  const percentOk = (number, min, max) => number !== '' && number >= min && number <= max
  const canAdd = draft.label.trim().length >= 2 && /^[a-z]/.test(newKey) && !value.some((type) => type.key === newKey) && percentOk(draft.haircut, 0, 0.99) && percentOk(draft.ltv, 0.01, 1)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await saveCatalog({ types: value, items: catalog.items }, notify, 'Collateral types'))
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Collateral types"
        description="Classes of security, and how each is valued: the haircut comes off the applicant’s stated value, and the loan-to-value ratio is the share of what is left that can be lent against. Switch a type off to stop offering its items."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Collateral type name</th>
                <th className="w-32 px-3 py-2 font-medium">Haircut %</th>
                <th className="w-32 px-3 py-2 font-medium">Loan to value %</th>
                <th className="w-20 px-3 py-2 font-medium">Active</th>
                <th className="w-12 px-3 py-2">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {value.map((type) => (
                <tr key={type.key} className={cn(type.retired && 'opacity-60')}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Shield className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <Input aria-label="Collateral type name" value={type.label} onChange={(event) => update(type.key, { label: event.target.value })} className="h-9 text-sm" />
                    </div>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">{itemsOf(type.key) === 1 ? '1 item' : `${itemsOf(type.key)} items`}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      aria-label={`${type.label} haircut %`}
                      type="number"
                      step="any"
                      min="0"
                      max="99"
                      value={asPercent(type.haircut)}
                      onChange={(event) => update(type.key, { haircut: fromPercent(event.target.value) })}
                      className="h-9 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      aria-label={`${type.label} loan to value %`}
                      type="number"
                      step="any"
                      min="1"
                      max="100"
                      value={asPercent(type.ltv)}
                      onChange={(event) => update(type.key, { ltv: fromPercent(event.target.value) })}
                      className="h-9 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      aria-label={`${type.label} active`}
                      checked={!type.retired}
                      onChange={(event) => update(type.key, { retired: !event.target.checked })}
                      className="mt-2.5 size-4 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 text-destructive"
                      disabled={itemsOf(type.key) > 0}
                      onClick={() => setValue((prev) => prev.filter((entry) => entry.key !== type.key))}
                      aria-label={`Delete ${type.label}`}
                      title={itemsOf(type.key) > 0 ? 'Collateral items use this type. Move or delete them first.' : 'Delete. If applications already use it, it is switched off instead.'}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field id="new-collateral-type" label="Add a type">
            <Input id="new-collateral-type" placeholder="e.g. Livestock" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="h-9 w-56 text-sm" />
          </Field>
          <Field id="new-collateral-haircut" label="Haircut %">
            <Input
              id="new-collateral-haircut"
              type="number"
              step="any"
              placeholder="e.g. 30"
              value={asPercent(draft.haircut)}
              onChange={(event) => setDraft({ ...draft, haircut: fromPercent(event.target.value) })}
              className="h-9 w-28 text-sm"
            />
          </Field>
          <Field id="new-collateral-ltv" label="Loan to value %">
            <Input
              id="new-collateral-ltv"
              type="number"
              step="any"
              placeholder="e.g. 70"
              value={asPercent(draft.ltv)}
              onChange={(event) => setDraft({ ...draft, ltv: fromPercent(event.target.value) })}
              className="h-9 w-28 text-sm"
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            onClick={() => {
              setValue((prev) => [...prev, { key: newKey, label: draft.label.trim(), haircut: draft.haircut, ltv: draft.ltv, retired: false }])
              setDraft({ label: '', haircut: '', ltv: '' })
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
      </Panel>
      <SaveCard
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={() => setValue(catalog.types)}
        note="Applies to applications submitted from now on; submitted ones keep the haircut and loan-to-value they were filed with."
      />
    </div>
  )
}

function CollateralItems({ catalog, onSaved, notify }) {
  const [value, setValue] = useState(catalog.items)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ code: '', type: '', name: '' })
  useEffect(() => setValue(catalog.items), [catalog.items])
  const dirty = JSON.stringify(value) !== JSON.stringify(catalog.items)
  const update = (index, changes) => setValue((prev) => prev.map((item, position) => (position === index ? { ...item, ...changes } : item)))
  const typeOf = (key) => catalog.types.find((type) => type.key === key)
  const codeOf = (text) => text.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20)
  const draftProblem = !draft.code
    ? null
    : !COLLATERAL_CODE_PATTERN.test(draft.code)
      ? 'A code needs 2 to 20 capital letters, numbers or dashes.'
      : value.some((item) => item.code === draft.code)
        ? 'Another item already uses this code.'
        : null
  const duplicate = value.find((item, index) => value.findIndex((entry) => entry.code === item.code) !== index)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await saveCatalog({ types: catalog.types, items: value }, notify, 'Collateral items'))
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Collateral items"
        description="What applicants pick when they pledge collateral. Each takes the haircut and loan-to-value ratio of its type (set under Collateral types); applicants enter the value themselves."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-36 px-3 py-2 font-medium">Collateral code</th>
                <th className="w-52 px-3 py-2 font-medium">Collateral type</th>
                <th className="px-3 py-2 font-medium">Collateral name</th>
                <th className="w-24 px-3 py-2 font-medium">Loan to value</th>
                <th className="w-20 px-3 py-2 font-medium">Haircut</th>
                <th className="w-16 px-3 py-2 font-medium">Active</th>
                <th className="w-12 px-3 py-2">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {value.map((item, index) => {
                const type = typeOf(item.type)
                return (
                  <tr key={index} className={cn((item.retired || type?.retired) && 'opacity-60')}>
                    <td className="px-3 py-2">
                      <Input aria-label="Collateral code" value={item.code} onChange={(event) => update(index, { code: codeOf(event.target.value) })} className="h-9 font-mono text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      <Select aria-label={`${item.code} collateral type`} value={item.type} onChange={(event) => update(index, { type: event.target.value })} className="h-9 text-sm">
                        {catalog.types.map((entry) => (
                          <option key={entry.key} value={entry.key}>
                            {entry.label}
                            {entry.retired ? ' (off)' : ''}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`${item.code} collateral name`} value={item.name} onChange={(event) => update(index, { name: event.target.value })} className="h-9 text-sm" />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground" aria-readonly="true">
                      {type ? `${asPercent(type.ltv)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground" aria-readonly="true">
                      {type ? `${asPercent(type.haircut)}%` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${item.code} active`}
                        checked={!item.retired}
                        onChange={(event) => update(index, { retired: !event.target.checked })}
                        className="size-4 accent-primary"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-destructive"
                        onClick={() => setValue((prev) => prev.filter((_, position) => position !== index))}
                        aria-label={`Delete ${item.code}`}
                        title="Delete. If applications already use it, it is switched off instead."
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!value.length ? <p className="mt-3 text-sm text-muted-foreground">No items yet: applicants have nothing to pledge until you add some.</p> : null}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field id="new-collateral-code" label="Collateral code">
            <Input id="new-collateral-code" placeholder="e.g. MV-CAR" value={draft.code} onChange={(event) => setDraft({ ...draft, code: codeOf(event.target.value) })} className="h-9 w-36 font-mono text-sm" />
          </Field>
          <Field id="new-collateral-item-type" label="Collateral type">
            <Select id="new-collateral-item-type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="h-9 w-52 text-sm">
              <option value="">Choose…</option>
              {catalog.types
                .filter((type) => !type.retired)
                .map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="new-collateral-name" label="Collateral name">
            <Input id="new-collateral-name" placeholder="e.g. Passenger vehicle" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-9 w-56 text-sm" />
          </Field>
          {typeOf(draft.type) ? (
            <p className="pb-2 text-xs text-muted-foreground">
              LTV {asPercent(typeOf(draft.type).ltv)}% · haircut {asPercent(typeOf(draft.type).haircut)}%
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!draft.code || Boolean(draftProblem) || !draft.type || draft.name.trim().length < 2}
            onClick={() => {
              setValue((prev) => [...prev, { code: draft.code, type: draft.type, name: draft.name.trim(), retired: false }])
              setDraft({ code: '', type: '', name: '' })
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
        {draftProblem ? <p className="mt-2 text-xs text-destructive">{draftProblem}</p> : null}
        {duplicate ? <p className="mt-2 text-xs text-destructive">The code {duplicate.code} is used twice.</p> : null}
      </Panel>
      <SaveCard
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={() => setValue(catalog.items)}
        note="Applicants see the change straight away. Items already used on applications are switched off rather than deleted."
      />
    </div>
  )
}
