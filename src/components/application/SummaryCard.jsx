import React from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SummaryRow({ label, value }) {
  const isEmpty = value === undefined || value === null || value === ''

  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/70 py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={isEmpty ? 'text-right text-sm text-muted-foreground/70' : 'text-right text-sm font-medium text-foreground'}>
        {isEmpty ? '—' : value}
      </dd>
    </div>
  )
}

export function SummaryCard({ title, stepIndex, onEdit, children }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {typeof stepIndex === 'number' && onEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(stepIndex)} className="-mr-2 h-8">
            <Pencil />
            Edit
            <span className="sr-only"> {title}</span>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        <dl>{children}</dl>
      </CardContent>
    </Card>
  )
}
