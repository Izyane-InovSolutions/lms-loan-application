import React from 'react'
import { AlertTriangle, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FORM_TARGETS, readPath } from '@/config/kyc'
import { Panel, dateTime } from '../components'

const HOW = {
  record: 'Confirmed with a code sent to a contact on the record.',
  agent: 'Looked up by the agent with the customer.',
  other: 'Chose a different contact than the record’s, so the form wasn’t filled from it (or only partly).',
  none: 'The ID was changed after the lookup, so the record doesn’t apply to this application.',
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/**
 * The customer's record on the institution's platform, as looked up when the application
 * started (applications.kyc, api/_lib/kyc/lookups.js): how the applicant confirmed, and
 * each mapped field next to what was submitted, with the differences marked.
 */
export function KycPanel({ application }) {
  const kyc = application.kyc
  const targets = FORM_TARGETS[application.loanType] || {}
  const rows = Object.entries(kyc.values || {}).map(([field, recorded]) => ({ field, label: targets[field]?.label || field, recorded, submitted: readPath(application.data, field) }))
  const differences = rows.filter((row) => !same(row.recorded, row.submitted)).length

  return (
    <Panel title="Customer record" description={kyc.found ? `${kyc.source}, looked up ${dateTime(kyc.at)}` : undefined}>
      <div className="space-y-3 text-sm">
        {!kyc.found ? (
          <p className="text-muted-foreground">{kyc.failed ? 'The customer records couldn’t be reached when the application started.' : 'Not on the customer records.'}</p>
        ) : (
          <>
            <p className={cn('flex items-start gap-1.5', kyc.contact === 'record' || kyc.contact === 'agent' ? 'text-success' : 'text-warning')}>
              {kyc.contact === 'record' || kyc.contact === 'agent' ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              {HOW[kyc.contact] || HOW.none}
            </p>
            {kyc.contactsOnRecord?.mobile || kyc.contactsOnRecord?.email ? (
              <p className="text-muted-foreground">On record: {[kyc.contactsOnRecord.mobile, kyc.contactsOnRecord.email].filter(Boolean).join(', ')}</p>
            ) : null}
            {rows.length ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Field</th>
                      <th className="px-3 py-2 font-medium">On record</th>
                      <th className="px-3 py-2 font-medium">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => {
                      const differs = !same(row.recorded, row.submitted)
                      return (
                        <tr key={row.field} className={differs ? 'bg-warning/10' : undefined}>
                          <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                          <td className="px-3 py-1.5 text-foreground">{row.recorded}</td>
                          <td className={cn('px-3 py-1.5', differs ? 'font-medium text-foreground' : 'text-foreground')}>{row.submitted || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {differences ? <p className="text-xs text-warning">{differences === 1 ? '1 field differs' : `${differences} fields differ`} from the record. The applicant may have updated it; check with them.</p> : null}
          </>
        )}
      </div>
    </Panel>
  )
}
