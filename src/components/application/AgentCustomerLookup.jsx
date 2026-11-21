import React, { useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { KYC_ID_TYPES } from '@/config/kyc'
import { NRC_INPUT_PROPS, formatNrc } from '@/utils/nrc'

/**
 * For an agent filling in an application with a customer: look them up on the
 * institution's records (Settings → Customer records) and fill the form at once. No code:
 * the agent is signed in, and each lookup is in the audit log. Documents are still uploaded.
 */
export function AgentCustomerLookup({ form = 'personal', kyc, onFound }) {
  const types = Object.keys(KYC_ID_TYPES).filter((type) => KYC_ID_TYPES[type].form === form && kyc?.[type])
  const [idType, setIdType] = useState(types[0])
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  if (!types.length) return null

  const run = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/kyc/lookup/assisted', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idType, id }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'The lookup didn’t work. Fill the form in by hand.')
      if (!data.found) {
        setMessage({ tone: 'muted', text: data.failed ? 'The customer records couldn’t be reached. Fill the form in by hand.' : 'Not on the customer records. Fill the form in by hand.' })
        return
      }
      await onFound({ reference: data.reference, fill: { values: data.values, idField: data.idField, id: data.id } })
      setMessage({ tone: 'success', text: 'Filled from the customer records. Check each step with the customer.' })
    } catch (lookupError) {
      setMessage({ tone: 'error', text: lookupError.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={run} className="rounded-lg border border-primary/25 bg-primary/5 p-4 print:hidden" noValidate>
      <p className="text-sm font-medium text-foreground">Look up the customer</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {types.length > 1 ? (
          <Select aria-label="ID type" value={idType} onChange={(event) => {
            setIdType(event.target.value)
            setId('')
          }} className="sm:w-36">
            {types.map((type) => (
              <option key={type} value={type}>
                {KYC_ID_TYPES[type].label}
              </option>
            ))}
          </Select>
        ) : null}
        <Input
          aria-label={`${KYC_ID_TYPES[idType].label} number`}
          value={id}
          onChange={(event) => setId(idType === 'nrc' ? formatNrc(event.target.value) : event.target.value)}
          placeholder={idType === 'tpin' ? 'TPIN' : idType === 'passport' ? 'Passport number' : 'NRC, 123456/78/9'}
          {...(idType === 'nrc' ? NRC_INPUT_PROPS : {})}
        />
        <Button type="submit" variant="outline" disabled={busy || !id.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          Look up
        </Button>
      </div>
      {message ? (
        <p role="status" className={message.tone === 'error' ? 'mt-2 text-sm text-destructive' : message.tone === 'success' ? 'mt-2 flex items-center gap-1.5 text-sm text-success' : 'mt-2 text-sm text-muted-foreground'}>
          {message.tone === 'success' ? <Check className="size-4" aria-hidden="true" /> : null}
          {message.text}
        </p>
      ) : null}
    </form>
  )
}
