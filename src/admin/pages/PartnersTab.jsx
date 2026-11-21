import React, { useRef, useState } from 'react'
import { Check, FileUp, Loader2, Plus, Search, Trash2, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { partnerActive } from '@/config/partners'
import { api } from '../api'
import { EmptyState, Field, FormError, Panel, dateTime } from '../components'
import { SaveBar, Toggle, useSettingGroup } from './SettingsPage'

const blankPartner = () => ({ id: '', name: '', mouReference: '', mouEndsOn: '', active: true, staffList: null, isNew: true })

/**
 * Settings → Partners: the MoU partners whose employees get pre-approved loans
 * (src/config/partners.js), and each one's staff list. A loan product is made pre-approved
 * for one of them on the Loan products tab; their own staff confirm applicants on the
 * Partner requests page.
 */
export function PartnersTab({ settings, notify, onSaved }) {
  const group = useSettingGroup('partners', settings.partners, notify)
  const list = group.value.list || []
  const update = (index, changes) => group.set({ list: list.map((partner, at) => (at === index ? { ...partner, ...changes } : partner)) })

  return (
    <div className="max-w-3xl space-y-6">
      <Panel
        title="Partners"
        description="Organisations you have an MoU with. Their employees can apply for loan products pre-approved for them: the partner confirms each applicant works there, then a loan officer or sales manager issues the offer straight away."
      >
        {list.length ? (
          <ul className="space-y-4">
            {list.map((partner, index) => (
              <li key={partner.id || `new-${index}`} className="rounded-lg border p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`partner-name-${index}`} label="Partner">
                    <Input id={`partner-name-${index}`} value={partner.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="Zesco Limited" />
                  </Field>
                  <Field id={`partner-mou-${index}`} label="MoU reference">
                    <Input id={`partner-mou-${index}`} value={partner.mouReference} onChange={(event) => update(index, { mouReference: event.target.value })} placeholder="MOU-2026-014" />
                  </Field>
                  <Field id={`partner-ends-${index}`} label="MoU ends on" hint="No new applications are sent to the partner after this day.">
                    <Input id={`partner-ends-${index}`} type="date" value={partner.mouEndsOn} onChange={(event) => update(index, { mouEndsOn: event.target.value })} />
                  </Field>
                  <div className="flex items-end justify-between gap-3">
                    <Toggle
                      id={`partner-active-${index}`}
                      label="Taking applications"
                      description={partner.active ? '' : 'Paused: applications go through the usual review.'}
                      checked={partner.active !== false}
                      onChange={(active) => update(index, { active })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${partner.name || 'this partner'}`}
                      onClick={() => group.set({ list: list.filter((_, at) => at !== index) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {partner.isNew || !partner.id ? (
                  <p className="mt-3 text-xs text-muted-foreground">Save to upload this partner’s staff list.</p>
                ) : (
                  <StaffList partner={partner} notify={notify} onUploaded={onSaved} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Users} title="No partners yet">
            Add the organisations you have an MoU with.
          </EmptyState>
        )}
        <Button variant="outline" size="sm" className="mt-4" onClick={() => group.set({ list: [...list, blankPartner()] })}>
          <Plus />
          Add a partner
        </Button>
        <FormError message={group.error} />
        <SaveBar
          dirty={group.dirty}
          saving={group.saving}
          onSave={async () => {
            const saved = await group.save({ list: list.map(({ isNew: _isNew, ...partner }) => partner) })
            if (saved) onSaved()
          }}
        />
      </Panel>
    </div>
  )
}

/** A partner's staff list: its state, a CSV upload that replaces it, and a lookup of one NRC. */
function StaffList({ partner, notify, onUploaded }) {
  const input = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [nrc, setNrc] = useState('')
  const [lookup, setLookup] = useState(null)
  const list = partner.staffList
  const live = partnerActive(partner)

  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    setResult(null)
    try {
      const csv = await file.text()
      const response = await api(`/admin/partners/${partner.id}/staff`, { method: 'POST', body: { csv } })
      setResult(response)
      notify(`Staff list uploaded: ${response.count.toLocaleString()} people`)
      onUploaded()
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  const check = async (event) => {
    event.preventDefault()
    setLookup(null)
    try {
      setLookup(await api(`/admin/partners/${partner.id}/staff?nrc=${encodeURIComponent(nrc.trim())}`))
    } catch (lookupError) {
      setLookup({ error: lookupError.message })
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium text-foreground">Staff list</span>
          <span className={cn('ml-2 rounded-full px-2 py-0.5 text-xs', live ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>{live ? 'Active' : 'Not taking applications'}</span>
          <p className="mt-0.5 text-muted-foreground">
            {list?.count
              ? `${list.count.toLocaleString()} people, uploaded ${dateTime(list.uploadedAt)}${list.uploadedByName ? ` by ${list.uploadedByName}` : ''}.`
              : 'None uploaded. The partner can still confirm applicants without one.'}
          </p>
        </div>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => upload(event.target.files?.[0])} aria-label={`Staff list CSV for ${partner.name}`} />
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
          {list?.count ? 'Replace staff list' : 'Upload staff list'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">A CSV whose first row names the columns: nrc (required), employee_number and name. Each upload replaces the last.</p>
      {result?.skipped ? (
        <p role="status" className="text-sm text-warning">
          {result.skipped} {result.skipped === 1 ? 'row was' : 'rows were'} skipped for a missing or malformed NRC (line {result.errors.join(', ')}
          {result.skipped > result.errors.length ? ', …' : ''}).
        </p>
      ) : null}
      <FormError message={error} />
      {list?.count ? (
        <form onSubmit={check} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input aria-label="NRC to look up" value={nrc} onChange={(event) => setNrc(event.target.value)} placeholder="123456/78/9" className="h-9 sm:w-48" />
          <Button type="submit" variant="ghost" size="sm" disabled={!nrc.trim()}>
            <Search />
            Check an NRC
          </Button>
          {lookup ? (
            <span role="status" className={cn('text-sm', lookup.error ? 'text-destructive' : lookup.found ? 'text-success' : 'text-muted-foreground')}>
              {lookup.error ? (
                lookup.error
              ) : lookup.found ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" aria-hidden="true" />
                  On the list{lookup.employeeNumber ? `, employee no. ${lookup.employeeNumber}` : ''}
                  {lookup.name ? ` (${lookup.name})` : ''}
                </span>
              ) : (
                'Not on the list'
              )}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
