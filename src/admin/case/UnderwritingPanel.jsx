import React, { useEffect, useId, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Eye, FileText, Loader2, Paperclip, Pencil, Plus, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { collateralItems, itemLabel } from '@/config/collateral'
import { lendingCover } from '@/config/appraisal'
import { LEGAL_CHECKS, LEGAL_ROLES, VALUATION_METHODS, legalDocumentsOf, nextLegalSlot, underwritingStatus } from '@/config/underwriting'
import { FormError, Panel, money, timeAgo } from '../components'
import { DocumentPreview, ReviewRow } from './LegalReview'

/*
 * The case's Underwriting tab (src/config/underwriting.js), in up to three sections, each
 * saying whether it is complete or what is missing:
 *   Asset valuation      per pledged asset: details, the valuer's report (first), the figures
 *                        and a remark (cases.work).
 *   Legal verification   per pledged asset: the title documents, title information, who
 *                        verified it, the six checks with notes, a remark (legal.verify).
 *   Document verification  every required document's current copy: verified or an issue
 *                        (legal.verify or cases.work).
 * A loan without assets has only the documents.
 */

const textareaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
const today = () => new Date().toISOString().slice(0, 10)

export function UnderwritingPanel({
  application,
  documents,
  product,
  collateralCatalog,
  status: given,
  requires,
  canValue,
  canLegal,
  canVerifyDocuments,
  onSaveValuation,
  onUploadReport,
  onSaveLegal,
  onUploadLegal,
  onVerifyDocument,
  onComment,
}) {
  const [viewing, setViewing] = useState(null)
  // The server's while the case is at the stage; worked out here once it has passed, with the
  // sections the workspace asks for (requires: { requireValuation, requireLegalReview }).
  const status = given || underwritingStatus(application, documents, product, collateralCatalog, requires || {})
  const items = collateralItems(application.data)
  const cover = items.length ? lendingCover(application, collateralCatalog) : null
  const byId = (id) => documents.find((document) => document.id === id) || null

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-3 rounded-xl border px-5 py-4', status.complete ? 'border-success/30 bg-success/5' : 'bg-card')}>
        {status.complete ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{status.complete ? 'Underwriting is complete' : 'Underwriting isn’t complete yet'}</p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {status.complete
              ? 'Every section is done. The case can move on to the decision.'
              : `Waiting for ${status.hold}. Approve stays greyed out until then.`}
          </p>
        </div>
      </div>

      {cover?.short ? <CoverWarning cover={cover} /> : null}

      {items.map((item, index) => (
        <div key={index} className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            Collateral {index + 1}: {itemLabel(item, collateralCatalog)}
          </h2>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <ValuationCard
              item={item}
              index={index}
              valuation={application.valuations?.[index]}
              entry={status.valuation[index]}
              catalog={collateralCatalog}
              editable={canValue}
              report={byId(application.valuations?.[index]?.reportId)}
              onView={setViewing}
              onSave={(values) => onSaveValuation(index, values)}
              onUpload={(file) => onUploadReport(index, file)}
            />
            <LegalCard
              index={index}
              record={application.verifications?.legal?.[index]}
              entry={status.legal[index]}
              editable={canLegal}
              documentOf={byId}
              onView={setViewing}
              onSave={(values) => onSaveLegal(index, values)}
              onUpload={(slot, file, label) => onUploadLegal(index, slot, file, label)}
            />
          </div>
        </div>
      ))}

      <Panel
        title="Document verification"
        description="The current copy of each required document. A new copy needs checking again."
        action={<SectionState complete={status.documents.every((document) => document.status === 'verified')} missing={status.documents.filter((document) => document.status !== 'verified').map((document) => document.label)} />}
        bodyClassName="p-0"
      >
        {status.documents.length ? (
          <ul className="divide-y">
            {status.documents.map((entry) => {
              const document = byId(entry.id)
              return (
                <ReviewRow
                  key={entry.id}
                  check={application.verifications?.documents?.[entry.id]}
                  comments={application.verifications?.comments?.[`document:${entry.id}`] || []}
                  canVerify={canVerifyDocuments}
                  canComment={canVerifyDocuments && Boolean(onComment)}
                  onVerify={(next, note) => onVerifyDocument(entry.id, next, note)}
                  onComment={(text) => onComment('document', entry.id, text)}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="[overflow-wrap:anywhere]">{entry.label}</span>
                    </span>
                    {document ? (
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setViewing(document)}>
                        <Eye />
                        View
                      </Button>
                    ) : null}
                  </div>
                  {document ? (
                    <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {document.filename} · added {timeAgo(document.createdAt)}
                    </p>
                  ) : null}
                </ReviewRow>
              )
            })}
          </ul>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">No required documents on this case yet.</p>
        )}
      </Panel>

      <DocumentPreview applicationId={application.id} document={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/** The approved amount against what the assets can be lent against: a warning, never a hold. */
export function CoverWarning({ cover }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        The approved amount ({money(cover.amount)}) is more than the assets’ lending value ({money(cover.lendingValue)}). The decision is yours.
      </span>
    </p>
  )
}

/** "Complete", or what is missing, for a section's header. */
function SectionState({ complete, missing = [], issues = 0, earlier = false }) {
  if (complete) {
    return (
      <span
        title={earlier ? 'Accepted from the review done before underwriting was set up' : undefined}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success"
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {earlier ? 'Complete (earlier review)' : 'Complete'}
      </span>
    )
  }
  return (
    <span
      title={missing.length ? `Missing: ${missing.join(', ')}` : undefined}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', issues ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning')}
    >
      {issues ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <CircleDashed className="size-3.5" aria-hidden="true" />}
      {issues ? `${issues} ${issues === 1 ? 'issue' : 'issues'}` : `${missing.length} to do`}
    </span>
  )
}

function Missing({ entry }) {
  if (!entry || entry.complete) return null
  return <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Missing: {entry.missing.join(', ')}.</p>
}

function Labelled({ label, error, className, children }) {
  return (
    <label className={cn('block space-y-1 text-xs text-muted-foreground', className)}>
      {label}
      {children}
      {error ? <span className="block text-xs text-destructive">{error}</span> : null}
    </label>
  )
}

function Facts({ rows }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!shown.length) return null
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-foreground [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function SubHeading({ children }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
}

/** A file button: a label around a hidden input, so it opens the picker. */
function FilePicker({ label, busy, onFile, disabled = false, variant = 'outline' }) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium focus-within:ring-2 focus-within:ring-ring',
        variant === 'outline' ? 'border border-input hover:bg-muted/40' : 'bg-primary text-primary-foreground hover:bg-primary/90',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="size-3.5" aria-hidden="true" />}
      {label}
      <input
        id={id}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
    </label>
  )
}

const valuationForm = (valuation, item, catalog) => ({
  asset: {
    type: valuation?.asset?.type || itemLabel(item, catalog),
    assetId: valuation?.asset?.assetId || item.code || '',
    owner: valuation?.asset?.owner || '',
    description: valuation?.asset?.description || String(item.description || '').trim(),
    location: valuation?.asset?.location || '',
  },
  valuationAmount: valuation?.valuationAmount ?? '',
  method: valuation?.method || '',
  marketValue: valuation?.marketValue ?? '',
  forcedSaleValue: valuation?.forcedSaleValue ?? '',
  valuedOn: valuation?.valuedOn || '',
  valuer: valuation?.valuer || '',
  valuerCompany: valuation?.valuerCompany || '',
  valuerLicence: valuation?.valuerLicence || '',
  valuerContact: valuation?.valuerContact || '',
  remark: valuation?.remark || '',
})

const valuationErrors = (values) => {
  const errors = {}
  if (String(values.asset.description).trim().length < 3) errors.description = 'Describe the asset.'
  const market = Number(values.marketValue)
  if (!(market > 0)) errors.marketValue = 'Enter the market value.'
  if (values.forcedSaleValue !== '' && Number(values.forcedSaleValue) > market) errors.forcedSaleValue = 'Can’t be more than the market value.'
  if (!values.valuedOn) errors.valuedOn = 'Enter the valuation date.'
  else if (values.valuedOn > today()) errors.valuedOn = 'Can’t be in the future.'
  return errors
}

/** One asset's valuation: its details, the valuer's report (first), the figures and a remark. */
function ValuationCard({ item, valuation, entry, catalog, editable, report, onView, onSave, onUpload }) {
  const [values, setValues] = useState(() => valuationForm(valuation, item, catalog))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  // A save starts the form again from what is saved; attaching the report keeps what is typed.
  useEffect(() => {
    setValues(valuationForm(valuation, item, catalog))
    setTried(false)
  }, [valuation?.at])

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
    } catch (runError) {
      setError(runError.message)
    } finally {
      setBusy(null)
    }
  }
  const setAsset = (key) => (event) => setValues((prev) => ({ ...prev, asset: { ...prev.asset, [key]: event.target.value } }))
  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))
  const errors = tried ? valuationErrors(values) : {}
  const hasReport = Boolean(valuation?.reportId)
  const methodLabel = VALUATION_METHODS.find(([key]) => key === valuation?.method)?.[1]

  const save = (event) => {
    event.preventDefault()
    setTried(true)
    if (Object.keys(valuationErrors(values)).length) return
    run('save', () => onSave(values))
  }

  const reportRow = (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">Valuation report</p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {report ? `${report.filename} · added ${timeAgo(report.createdAt)}` : editable ? 'Attach it first: PDF, JPG or PNG, up to 20 MB.' : 'Not attached.'}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {report ? (
          <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => onView(report)}>
            <Eye />
            View
          </Button>
        ) : null}
        {editable ? <FilePicker label={hasReport ? 'Replace' : 'Attach report'} variant={hasReport ? 'outline' : 'primary'} busy={busy === 'upload'} onFile={(file) => run('upload', () => onUpload(file))} /> : null}
      </div>
    </div>
  )

  if (!editable) {
    return (
      <Panel title="Asset valuation" action={<SectionState complete={entry?.complete} missing={entry?.missing} earlier={entry?.earlier} />}>
        <div className="space-y-4">
          <Missing entry={entry} />
          <Facts
            rows={[
              ['Asset type', valuation?.asset?.type || itemLabel(item, catalog)],
              ['Asset ID', valuation?.asset?.assetId || item.code],
              ['Registered owner', valuation?.asset?.owner],
              ['Location', valuation?.asset?.location],
              ['Description', valuation?.asset?.description || item.description],
            ]}
          />
          {reportRow}
          {Number(valuation?.marketValue) > 0 ? (
            <Facts
              rows={[
                ['Market value', money(valuation.marketValue)],
                ['Forced-sale value', valuation.forcedSaleValue ? money(valuation.forcedSaleValue) : null],
                ['Valuation amount', valuation.valuationAmount ? money(valuation.valuationAmount) : null],
                ['Method', methodLabel],
                ['Valued on', valuation.valuedOn],
                ['Valuer', [valuation.valuer, valuation.valuerCompany].filter(Boolean).join(', ')],
                ['Licence no.', valuation.valuerLicence],
                ['Contact', valuation.valuerContact],
                ['Remark', valuation.remark],
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Not valued yet.</p>
          )}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Asset valuation" action={<SectionState complete={entry?.complete} missing={entry?.missing} earlier={entry?.earlier} />}>
      <form onSubmit={save} noValidate className="space-y-4">
        <Missing entry={entry} />
        <div className="space-y-3">
          <SubHeading>Asset details</SubHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Asset type">
              <Input value={values.asset.type} onChange={setAsset('type')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Asset ID (optional)">
              <Input value={values.asset.assetId} onChange={setAsset('assetId')} className="h-9 text-sm" placeholder="e.g. plate or plot number" />
            </Labelled>
            <Labelled label="Registered owner (optional)">
              <Input value={values.asset.owner} onChange={setAsset('owner')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Location (optional)">
              <Input value={values.asset.location} onChange={setAsset('location')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Description" error={errors.description} className="sm:col-span-2">
              <textarea rows={2} value={values.asset.description} onChange={setAsset('description')} maxLength={500} className={textareaClass} />
            </Labelled>
          </div>
        </div>

        {reportRow}

        <fieldset disabled={!hasReport} className="space-y-3 disabled:opacity-60">
          <SubHeading>Valuation</SubHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Market value (K)" error={errors.marketValue}>
              <Input inputMode="decimal" value={values.marketValue} onChange={set('marketValue')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Forced-sale value (K, optional)" error={errors.forcedSaleValue}>
              <Input inputMode="decimal" value={values.forcedSaleValue} onChange={set('forcedSaleValue')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Valuation amount (K, optional)">
              <Input inputMode="decimal" value={values.valuationAmount} onChange={set('valuationAmount')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Method">
              <Select value={values.method} onChange={set('method')} className="h-9 text-sm">
                <option value="">Choose…</option>
                {VALUATION_METHODS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Labelled>
            <Labelled label="Valuation date" error={errors.valuedOn}>
              <Input type="date" max={today()} value={values.valuedOn} onChange={set('valuedOn')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Valuer name (optional)">
              <Input value={values.valuer} onChange={set('valuer')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Valuer company (optional)">
              <Input value={values.valuerCompany} onChange={set('valuerCompany')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Licence no. (optional)">
              <Input value={values.valuerLicence} onChange={set('valuerLicence')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Contact (optional)" className="sm:col-span-2">
              <Input value={values.valuerContact} onChange={set('valuerContact')} className="h-9 text-sm" placeholder="Phone or email" />
            </Labelled>
          </div>
          <Labelled label="Remark (optional)">
            <textarea rows={2} value={values.remark} onChange={set('remark')} maxLength={1000} className={textareaClass} />
          </Labelled>
        </fieldset>

        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!hasReport || Boolean(busy)}>
            {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
            Save valuation
          </Button>
          {!hasReport ? <p className="text-xs text-muted-foreground">Attach the valuation report first.</p> : valuation?.byName ? <p className="text-xs text-muted-foreground">Saved by {valuation.byName}, {timeAgo(valuation.at)}</p> : null}
        </div>
      </form>
    </Panel>
  )
}

const legalForm = (record) => ({
  title: { number: record?.title?.number || '', owner: record?.title?.owner || '', details: record?.title?.details || '' },
  verifiedBy: { name: record?.verifiedBy?.name || '', firm: record?.verifiedBy?.firm || '', role: record?.verifiedBy?.role || '', licence: record?.verifiedBy?.licence || '' },
  checks: Object.fromEntries(LEGAL_CHECKS.map(([key]) => [key, { done: Boolean(record?.checks?.[key]?.done), note: record?.checks?.[key]?.note || '' }])),
  remark: record?.remark || '',
})

/** How a check stands: done, an issue (not done, with a note), or not done. */
const checkState = (check) => (check?.done ? 'done' : check?.note ? 'issue' : 'open')

/** One asset's legal verification: documents, title, who verified it, the six checks, a remark. */
function LegalCard({ record, entry, editable, documentOf, onView, onSave, onUpload }) {
  const [values, setValues] = useState(() => legalForm(record))
  const [labels, setLabels] = useState({})
  const [renaming, setRenaming] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setValues(legalForm(record))
    setLabels({})
  }, [record?.at])

  const slots = legalDocumentsOf(record)
  const issues = LEGAL_CHECKS.filter(([key]) => checkState(record?.checks?.[key]) === 'issue').length
  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      return true
    } catch (runError) {
      setError(runError.message)
      return false
    } finally {
      setBusy(null)
    }
  }
  const setPart = (part, key) => (event) => setValues((prev) => ({ ...prev, [part]: { ...prev[part], [key]: event.target.value } }))
  const setCheck = (key, change) => setValues((prev) => ({ ...prev, checks: { ...prev.checks, [key]: { ...prev.checks[key], ...change } } }))
  const save = (event) => {
    event.preventDefault()
    run('save', () => onSave({ ...values, documents: Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, { label }])) }))
  }

  const documentList = (
    <ul className="divide-y rounded-md border">
      {Object.entries(slots).map(([key, slot]) => {
        const file = slot.documentId ? documentOf(slot.documentId) : null
        const label = labels[key] ?? slot.label
        return (
          <li key={key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              {renaming === key ? (
                <Input
                  autoFocus
                  aria-label="Document name"
                  value={label}
                  maxLength={120}
                  onChange={(event) => setLabels((prev) => ({ ...prev, [key]: event.target.value }))}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      setRenaming(null)
                    }
                  }}
                  className="h-8 text-sm"
                />
              ) : (
                <p className="font-medium text-foreground [overflow-wrap:anywhere]">
                  {label}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{slot.required ? 'Required' : 'Optional'}</span>
                </p>
              )}
              <p className={cn('text-xs [overflow-wrap:anywhere]', file || !slot.required ? 'text-muted-foreground' : 'text-warning')}>
                {file ? `${file.filename} · added ${timeAgo(file.createdAt)}` : 'Not attached'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {file ? (
                <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => onView(file)}>
                  <Eye />
                  View
                </Button>
              ) : null}
              {editable ? (
                <>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setRenaming(key)}>
                    <Pencil />
                    Rename
                  </Button>
                  <FilePicker label={file ? 'Replace' : 'Attach'} busy={busy === `upload:${key}`} onFile={(picked) => run(`upload:${key}`, () => onUpload(key, picked, label))} />
                </>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )

  if (!editable) {
    const role = LEGAL_ROLES.find(([key]) => key === record?.verifiedBy?.role)?.[1]
    return (
      <Panel title="Legal verification" action={<SectionState complete={entry?.complete} missing={entry?.missing} issues={issues} earlier={entry?.earlier} />}>
        <div className="space-y-4">
          <Missing entry={entry} />
          {documentList}
          <Facts
            rows={[
              ['Title / registration no.', record?.title?.number],
              ['Registered owner', record?.title?.owner],
              ['Registration details', record?.title?.details],
              ['Verified by', [record?.verifiedBy?.name, record?.verifiedBy?.firm, role].filter(Boolean).join(', ')],
              ['Licence no.', record?.verifiedBy?.licence],
            ]}
          />
          <ul className="space-y-1.5 text-sm">
            {LEGAL_CHECKS.map(([key, label]) => (
              <CheckLine key={key} label={label} check={record?.checks?.[key]} />
            ))}
          </ul>
          {record?.remark ? <Facts rows={[['Remark', record.remark]]} /> : null}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Legal verification" action={<SectionState complete={entry?.complete} missing={entry?.missing} issues={issues} earlier={entry?.earlier} />}>
      <form onSubmit={save} noValidate className="space-y-4">
        <Missing entry={entry} />
        <div className="space-y-2">
          <SubHeading>Documents</SubHeading>
          {documentList}
          {adding ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input autoFocus aria-label="Name of the document" placeholder="Name of the document" value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} className="h-8 text-sm sm:flex-1" />
              <div className="flex gap-2">
                <FilePicker
                  label="Choose file"
                  disabled={newName.trim().length < 2}
                  busy={busy === 'upload:new'}
                  onFile={async (file) => {
                    if (await run('upload:new', () => onUpload(nextLegalSlot(slots), file, newName.trim()))) {
                      setAdding(false)
                      setNewName('')
                    }
                  }}
                />
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setAdding(true)}>
              <Plus />
              Add document
            </Button>
          )}
          {Object.keys(labels).length ? <p className="text-xs text-muted-foreground">Save to keep the new names.</p> : null}
        </div>

        <div className="space-y-3">
          <SubHeading>Title information</SubHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Title / registration no.">
              <Input value={values.title.number} onChange={setPart('title', 'number')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Registered owner">
              <Input value={values.title.owner} onChange={setPart('title', 'owner')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Registration details" className="sm:col-span-2">
              <textarea rows={2} value={values.title.details} onChange={setPart('title', 'details')} maxLength={1000} className={textareaClass} />
            </Labelled>
          </div>
        </div>

        <div className="space-y-3">
          <SubHeading>Verified by</SubHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Name">
              <Input value={values.verifiedBy.name} onChange={setPart('verifiedBy', 'name')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Firm">
              <Input value={values.verifiedBy.firm} onChange={setPart('verifiedBy', 'firm')} className="h-9 text-sm" />
            </Labelled>
            <Labelled label="Role">
              <Select value={values.verifiedBy.role} onChange={setPart('verifiedBy', 'role')} className="h-9 text-sm">
                <option value="">Choose…</option>
                {LEGAL_ROLES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Labelled>
            <Labelled label="Licence no.">
              <Input value={values.verifiedBy.licence} onChange={setPart('verifiedBy', 'licence')} className="h-9 text-sm" />
            </Labelled>
          </div>
        </div>

        <div className="space-y-2">
          <SubHeading>Legal checks</SubHeading>
          <p className="text-xs text-muted-foreground">Tick each check once done. Left unticked with a note, it shows as an issue.</p>
          <ul className="divide-y rounded-md border">
            {LEGAL_CHECKS.map(([key, label]) => {
              const check = values.checks[key]
              const state = checkState(check)
              return (
                <li key={key} className="space-y-2 p-3">
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={check.done} onChange={(event) => setCheck(key, { done: event.target.checked })} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span className="min-w-0 flex-1">{label}</span>
                    {state === 'issue' ? <span className="shrink-0 text-xs font-medium text-destructive">Issue found</span> : null}
                  </label>
                  <Input aria-label={`Note on ${label.toLowerCase()}`} placeholder="Note (optional)" value={check.note} maxLength={500} onChange={(event) => setCheck(key, { note: event.target.value })} className="h-8 text-sm" />
                </li>
              )
            })}
          </ul>
        </div>

        <Labelled label="Remark (optional)">
          <textarea rows={2} value={values.remark} onChange={(event) => setValues((prev) => ({ ...prev, remark: event.target.value }))} maxLength={1000} className={textareaClass} />
        </Labelled>

        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={Boolean(busy)}>
            {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
            Save legal verification
          </Button>
          {record?.byName ? (
            <p className="text-xs text-muted-foreground">
              Saved by {record.byName}, {timeAgo(record.at)}
            </p>
          ) : null}
        </div>
      </form>
    </Panel>
  )
}

function CheckLine({ label, check }) {
  const state = checkState(check)
  return (
    <li className="flex items-start gap-2">
      {state === 'done' ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      ) : state === 'issue' ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="text-foreground">{label}</span>
        {state === 'issue' ? <span className="text-destructive"> · Issue found: {check.note}</span> : state === 'done' && check.note ? <span className="text-muted-foreground"> · {check.note}</span> : null}
        {state === 'open' ? <span className="text-muted-foreground"> · Not done</span> : null}
      </span>
    </li>
  )
}
