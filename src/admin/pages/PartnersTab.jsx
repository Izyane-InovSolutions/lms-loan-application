import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileUp, Handshake, Loader2, Pencil, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { partnerActive } from '@/config/partners'
import { formatNrc } from '@/utils/nrc'
import { buildProducts } from '@/config/loanProducts'
import { downloadStaffTemplate, readStaffFile } from '../staffListFile'
import { api } from '../api'
import { EmptyState, Field, FormError, Panel, dateTime } from '../components'
import { SaveBar, Toggle, useSettingGroup } from './SettingsPage'

const blankPartner = () => ({ id: '', name: '', mouReference: '', mouEndsOn: '', active: true, staffList: null, isNew: true })

const STAFF_PAGE_SIZE = 25

const shortDate = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Where a partner stands: taking applications, paused, its MoU ended, or not saved yet. */
const statusOf = (partner) => {
  if (partner.isNew || !partner.id) return { label: 'Not saved yet', tone: 'bg-primary/10 text-primary' }
  if (partnerActive(partner)) return { label: 'Taking applications', tone: 'bg-success/10 text-success' }
  if (!partner.mouEndsOn) return { label: 'No end date', tone: 'bg-warning/10 text-warning' }
  if (partner.mouEndsOn < new Date().toISOString().slice(0, 10)) return { label: 'MoU ended', tone: 'bg-muted text-muted-foreground' }
  return { label: 'Paused', tone: 'bg-muted text-muted-foreground' }
}

function StatusPill({ partner }) {
  const status = statusOf(partner)
  return <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', status.tone)}>{status.label}</span>
}

/**
 * Settings → Partners: the MoU partners whose employees get pre-approved loans
 * (src/config/partners.js), as a table; a partner opens on its own view (?partner=<id>),
 * to edit it and see its staff list. A loan product is made pre-approved for one of them
 * on the Loan products tab; their own staff confirm applicants on the Partner requests page.
 */
export function PartnersTab({ settings, notify, onSaved }) {
  const group = useSettingGroup('partners', settings.partners, notify)
  const list = group.value.list || []
  const [params, setParams] = useSearchParams()
  const selected = params.get('partner')
  const index = selected ? list.findIndex((partner, at) => (partner.id || `new-${at}`) === selected) : -1
  const products = useMemo(() => Object.values(buildProducts(settings.products || {})).filter((product) => !product.deleted), [settings.products])

  const open = (key) => {
    const next = new URLSearchParams(params)
    if (key) next.set('partner', key)
    else next.delete('partner')
    setParams(next, { replace: !key })
  }
  const update = (at, changes) => group.set({ list: list.map((partner, i) => (i === at ? { ...partner, ...changes } : partner)) })
  const add = () => {
    group.set({ list: [...list, blankPartner()] })
    open(`new-${list.length}`)
  }
  const save = async () => {
    const saved = await group.save({ list: list.map(({ isNew: _isNew, ...partner }) => partner) })
    if (!saved) return
    onSaved()
    // A new partner gets its id on saving: stay on it under that id.
    if (selected?.startsWith('new-') && saved.list?.[index]?.id) open(saved.list[index].id)
  }
  const remove = (at) => {
    group.set({ list: list.filter((_, i) => i !== at) })
    open(null)
  }

  if (selected && index >= 0) {
    return (
      <PartnerDetail
        partner={list[index]}
        index={index}
        products={products.filter((product) => product.preApproval?.enabled && product.preApproval.partnerId === list[index].id)}
        group={group}
        notify={notify}
        onBack={() => open(null)}
        onChange={(changes) => update(index, changes)}
        onRemove={() => remove(index)}
        onSave={save}
        onUploaded={onSaved}
      />
    )
  }

  return <PartnersTable list={list} products={products} group={group} onOpen={open} onAdd={add} onSave={save} />
}

/** Every partner in one table: the MoU, its products, the staff list and where it stands. A row opens the partner. */
function PartnersTable({ list, products, group, onOpen, onAdd, onSave }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const rows = list
    .map((partner, index) => ({ partner, key: partner.id || `new-${index}` }))
    .filter(({ partner }) => !needle || `${partner.name} ${partner.mouReference}`.toLowerCase().includes(needle))
  const taking = list.filter((partner) => partnerActive(partner)).length
  const productCount = (partner) => products.filter((product) => product.preApproval?.enabled && product.preApproval.partnerId === partner.id).length

  return (
    <div className="space-y-6">
      <Panel
        title="Partners"
        description="Organisations you have an MoU with. Their employees can apply for loan products pre-approved for them: the partner confirms each applicant works there, then a loan officer or sales manager issues the offer."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {list.length} {list.length === 1 ? 'partner' : 'partners'} · {taking} taking applications
          </p>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {list.length > 4 ? (
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input aria-label="Find a partner" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a partner or MoU" className="h-9 pl-8" />
              </div>
            ) : null}
            <Button size="sm" onClick={onAdd}>
              <Plus />
              Add a partner
            </Button>
          </div>
        </div>

        {list.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Partners</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Partner
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    MoU reference
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    MoU ends
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Products
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Staff list
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(({ partner, key }) => (
                  <tr key={key} className="group cursor-pointer transition-colors hover:bg-muted/30" onClick={() => onOpen(key)}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <Handshake className="size-4" aria-hidden="true" />
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpen(key)
                          }}
                          className="rounded text-left font-medium text-foreground group-hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {partner.name || 'New partner'}
                        </button>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{partner.mouReference || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{partner.mouEndsOn ? shortDate(partner.mouEndsOn) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{productCount(partner) || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{partner.staffList?.count ? `${partner.staffList.count.toLocaleString()} people` : 'None'}</td>
                    <td className="px-4 py-3">
                      <StatusPill partner={partner} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="ml-auto size-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No partner matches “{query}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Users} title="No partners yet">
            Add the organisations you have an MoU with.
          </EmptyState>
        )}
        <FormError message={group.error} />
        {/* A partner removed from its own view is only gone once saved. */}
        {group.dirty ? <SaveBar dirty={group.dirty} saving={group.saving} onSave={onSave} /> : null}
      </Panel>
    </div>
  )
}

/** One partner: its details to edit, the loan products pre-approved for it, and its staff list. */
function PartnerDetail({ partner, index, products, group, notify, onBack, onChange, onRemove, onSave, onUploaded }) {
  const saved = Boolean(partner.id) && !partner.isNew
  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All partners
        </button>
        <h2 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
          {partner.name || 'New partner'}
          <StatusPill partner={partner} />
        </h2>
        {partner.mouReference ? <p className="text-sm text-muted-foreground">MoU {partner.mouReference}</p> : null}
      </div>

      <Panel title="Details" description="Applications go to this partner to confirm employment while it is taking applications and its MoU hasn’t ended.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`partner-name-${index}`} label="Partner">
            <Input id={`partner-name-${index}`} value={partner.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="Zesco Limited" />
          </Field>
          <Field id={`partner-mou-${index}`} label="MoU reference">
            <Input id={`partner-mou-${index}`} value={partner.mouReference} onChange={(event) => onChange({ mouReference: event.target.value })} placeholder="MOU-2026-014" />
          </Field>
          <Field id={`partner-ends-${index}`} label="MoU ends on" hint="No new applications are sent to the partner after this day.">
            <Input id={`partner-ends-${index}`} type="date" value={partner.mouEndsOn} onChange={(event) => onChange({ mouEndsOn: event.target.value })} />
          </Field>
          <div className="flex items-end">
            <Toggle
              id={`partner-active-${index}`}
              label="Taking applications"
              description={partner.active !== false ? '' : 'Paused: applications go through the usual review.'}
              checked={partner.active !== false}
              onChange={(active) => onChange({ active })}
            />
          </div>
        </div>
        <div className="mt-5 border-t pt-4">
          <p className="text-sm font-medium text-foreground">Loan products</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {products.length ? products.map((product) => product.name).join(', ') : 'None yet. Make a product pre-approved for this partner on the Loan products tab.'}
          </p>
        </div>
        <FormError message={group.error} />
        <SaveBar dirty={group.dirty} saving={group.saving} onSave={onSave}>
          <Button variant="ghost" size="sm" className="mr-auto text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2 />
            Remove partner
          </Button>
        </SaveBar>
      </Panel>

      {saved ? (
        <StaffList partner={partner} notify={notify} onUploaded={onUploaded} />
      ) : (
        <Panel title="Staff list" description="Save the partner first, then upload their staff list.">
          <Button variant="outline" size="sm" onClick={() => downloadTemplate(partner, notify)}>
            <Download />
            Download the template
          </Button>
        </Panel>
      )}
    </div>
  )
}

/** Downloads the Excel template, saying so if it can't be made. */
const downloadTemplate = (partner, notify) => downloadStaffTemplate(partner).catch(() => notify('The template couldn’t be made. Try again.'))

/** A partner's staff list: who uploaded it and when, an upload (Excel or CSV) that replaces it, and the people on it, searchable, a page at a time. */
function StaffList({ partner, notify, onUploaded }) {
  const input = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [people, setPeople] = useState({ status: 'loading' })
  // The person being added ({}) or edited, and the one waiting on "Remove?".
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [reload, setReload] = useState(0)
  const list = partner.staffList
  // After a change by hand: this page again, and the partner's count.
  const changed = (message) => {
    notify(message)
    setReload((count) => count + 1)
    onUploaded()
  }

  // The search waits for a pause in typing, and starts again from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!list?.count) {
      setPeople({ status: 'ready', people: [], total: 0 })
      return undefined
    }
    let cancelled = false
    setPeople((prev) => ({ ...prev, status: prev.people ? 'refreshing' : 'loading' }))
    const query = new URLSearchParams({ page: String(page), pageSize: String(STAFF_PAGE_SIZE), ...(q ? { q } : {}) })
    api(`/admin/partners/${partner.id}/staff/people?${query}`)
      .then((data) => !cancelled && setPeople({ status: 'ready', ...data }))
      .catch((loadError) => !cancelled && setPeople({ status: 'error', message: loadError.message }))
    return () => {
      cancelled = true
    }
  }, [partner.id, list?.version, list?.count, page, q, reload])

  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    setResult(null)
    try {
      // An Excel sheet is read here into the same CSV text a CSV upload sends.
      const csv = await readStaffFile(file)
      if (!csv.trim()) throw new Error('That file has no rows to read.')
      const response = await api(`/admin/partners/${partner.id}/staff`, { method: 'POST', body: { csv } })
      setResult(response)
      setPage(1)
      notify(`Staff list uploaded: ${response.count.toLocaleString()} people`)
      onUploaded()
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  const total = people.total || 0
  const pages = Math.max(1, Math.ceil(total / STAFF_PAGE_SIZE))
  const from = total ? (page - 1) * STAFF_PAGE_SIZE + 1 : 0
  const to = Math.min(total, page * STAFF_PAGE_SIZE)

  return (
    <Panel
      title="Staff list"
      description={
        list?.count
          ? `${list.count.toLocaleString()} ${list.count === 1 ? 'person' : 'people'}${list.editedAt ? `, last changed ${dateTime(list.editedAt)}${list.editedByName ? ` by ${list.editedByName}` : ''}` : `, uploaded ${dateTime(list.uploadedAt)}${list.uploadedByName ? ` by ${list.uploadedByName}` : ''}`}. An upload replaces the whole list.`
          : 'None uploaded. The partner can still confirm applicants without one.'
      }
    >
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(event) => upload(event.target.files?.[0])}
        aria-label={`Staff list (Excel or CSV) for ${partner.name}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {list?.count ? (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="Find someone on the staff list" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, employee no. or NRC" className="h-9 pl-8" />
          </div>
        ) : (
          <p className="max-w-xl text-sm text-muted-foreground">Fill in the Excel template, one person per row, and upload it as it is. A CSV with the columns nrc, employee_number and name works too.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => downloadTemplate(partner, notify)}>
            <Download />
            Download template
          </Button>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
            {list?.count ? 'Replace staff list' : 'Upload staff list'}
          </Button>
          <Button size="sm" onClick={() => setEditing({})}>
            <UserPlus />
            Add a person
          </Button>
        </div>
      </div>
      {result?.skipped ? (
        <p role="status" className="mt-3 text-sm text-warning">
          {result.skipped} {result.skipped === 1 ? 'row was' : 'rows were'} skipped for a missing or malformed NRC (line {result.errors.join(', ')}
          {result.skipped > result.errors.length ? ', …' : ''}).
        </p>
      ) : null}
      <FormError message={error} />

      {list?.count ? (
        <div className="mt-4">
          {people.status === 'error' ? (
            <FormError message={people.message} />
          ) : people.status === 'loading' ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading the staff list…
            </p>
          ) : (
            <>
              <div className={cn('overflow-x-auto rounded-lg border transition-opacity', people.status === 'refreshing' && 'opacity-60')}>
                <table className="w-full min-w-[600px] text-sm">
                  <caption className="sr-only">Staff list of {partner.name}</caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Employee no.
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        NRC
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {people.people.map((person) => (
                      <tr key={person.nrc}>
                        <td className="px-4 py-2.5 text-foreground">{person.name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{person.employeeNumber || '—'}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{person.nrc}</td>
                        <td className="px-2 py-1.5 text-right">
                          <span className="inline-flex gap-1">
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${person.name || person.nrc}`} onClick={() => setEditing(person)}>
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" aria-label={`Remove ${person.name || person.nrc}`} onClick={() => setRemoving(person)}>
                              <Trash2 />
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!people.people.length ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                          {q ? `No one on the list matches “${q}”.` : 'The list is empty.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {total ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>
                    Showing{' '}
                    <span className="font-medium tabular-nums text-foreground">
                      {from.toLocaleString()}–{to.toLocaleString()}
                    </span>{' '}
                    of <span className="font-medium tabular-nums text-foreground">{total.toLocaleString()}</span>
                    {q ? ` matching “${q}”` : ''}
                  </span>
                  {pages > 1 ? (
                    <span className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                        <ChevronLeft />
                      </Button>
                      <span className="tabular-nums">
                        Page {page} of {pages}
                      </span>
                      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                        <ChevronRight />
                      </Button>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <PersonDialog
        partner={partner}
        person={editing}
        onClose={() => setEditing(null)}
        onSaved={(added) => {
          setEditing(null)
          changed(added ? 'Added to the staff list' : 'Staff member updated')
        }}
      />
      <RemovePersonDialog
        partner={partner}
        person={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null)
          changed('Removed from the staff list')
        }}
      />
    </Panel>
  )
}

/** Adding someone to the staff list (`person` is {}), or editing them: NRC, employee number and name. */
function PersonDialog({ partner, person, onClose, onSaved }) {
  const adding = !person?.id
  const [values, setValues] = useState({ nrc: '', employeeNumber: '', name: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!person) return
    setValues({ nrc: person.nrc || '', employeeNumber: person.employeeNumber || '', name: person.name || '' })
    setError('')
    setSaving(false)
  }, [person])
  const set = (field) => (event) => setValues((prev) => ({ ...prev, [field]: field === 'nrc' ? formatNrc(event.target.value) : event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const path = `/admin/partners/${partner.id}/staff/people${adding ? '' : `/${person.id}`}`
      await api(path, { method: adding ? 'POST' : 'PATCH', body: values })
      onSaved(adding)
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(person)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{adding ? 'Add a person' : 'Edit staff member'}</DialogTitle>
          <DialogDescription>{adding ? `Someone who works at ${partner.name}. Their applications are matched to the list by NRC.` : 'Changes apply to applications checked from now on.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field id="staff-nrc" label="NRC">
            <Input id="staff-nrc" inputMode="numeric" autoComplete="off" placeholder="123456/78/9" value={values.nrc} onChange={set('nrc')} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="staff-employee" label="Employee no. (optional)">
              <Input id="staff-employee" autoComplete="off" value={values.employeeNumber} onChange={set('employeeNumber')} />
            </Field>
            <Field id="staff-name" label="Name (optional)">
              <Input id="staff-name" autoComplete="off" value={values.name} onChange={set('name')} />
            </Field>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !values.nrc.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {adding ? 'Add' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Remove … from the staff list?" */
function RemovePersonDialog({ partner, person, onClose, onRemoved }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setError('')
    setBusy(false)
  }, [person])
  const remove = async () => {
    setBusy(true)
    try {
      await api(`/admin/partners/${partner.id}/staff/people/${person.id}`, { method: 'DELETE' })
      onRemoved()
    } catch (removeError) {
      setError(removeError.message)
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(person)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {person?.name || person?.nrc} from the staff list?</DialogTitle>
          <DialogDescription>New applications from them won’t match the list. {partner.name} can still confirm them by hand.</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
