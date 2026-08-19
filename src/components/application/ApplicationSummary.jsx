import React from 'react'
import { Eye, FileText, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useObjectUrl, isPreviewableImage, canPreview, formatBytes } from '@/hooks/useObjectUrl'
import mark from '@/assets/Icon.png'

/**
 * The overview step, laid out as a document rather than a dashboard.
 *
 * Everything here is print-aware: interactive affordances (Edit, Preview) carry
 * `print:hidden`, surfaces flatten to paper, and sections avoid breaking across
 * pages. Printing to PDF from this screen produces a clean application summary.
 */
export function ApplicationSummary({ loanTypeLabel, generatedOn, children }) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-soft',
        'print:overflow-visible print:rounded-none print:border-0 print:shadow-none'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-secondary/40 px-6 py-5 print:bg-transparent print:px-0 print:pt-0">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-border">
            <img src={mark} alt="" aria-hidden="true" className="size-full object-contain p-0.5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Loan Application Summary</h2>
            <p className="text-sm text-muted-foreground">{loanTypeLabel}</p>
          </div>
        </div>

        <dl className="text-right text-xs leading-relaxed text-muted-foreground">
          <div>
            <dt className="inline font-medium">Prepared </dt>
            <dd className="inline">{generatedOn}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Status </dt>
            <dd className="inline">Draft — not yet submitted</dd>
          </div>
        </dl>
      </header>

      <div className="px-6 pb-6 print:px-0 print:pb-0">{children}</div>
    </article>
  )
}

/** Highlighted band of headline figures, directly under the document header. */
export function SummaryHighlights({ items }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 print:break-inside-avoid">
      {items.map((item) => (
        <div key={item.label} className="bg-card px-4 py-3 print:bg-transparent">
          <dt className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-lg font-bold tabular-nums tracking-tight text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * `plain` renders the body as a div rather than a <dl> — used by the documents
 * section, whose content is an attachment list rather than term/definition pairs.
 */
export function SummarySection({ title, stepIndex, onEdit, columns = 2, plain = false, children }) {
  const Body = plain ? 'div' : 'dl'

  return (
    <section className="border-t border-border pt-5 first:border-t-0 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{title}</h3>
        {typeof stepIndex === 'number' && onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(stepIndex)}
            className="-mr-2 h-8 print:hidden"
          >
            <Pencil />
            Edit
            <span className="sr-only"> {title}</span>
          </Button>
        ) : null}
      </div>

      <Body className={cn('mt-2 grid gap-x-10', columns === 2 && !plain ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {children}
      </Body>
    </section>
  )
}

export function SummaryRow({ label, value }) {
  const isEmpty = value === undefined || value === null || value === ''

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-right text-sm',
          isEmpty ? 'text-muted-foreground/70' : 'font-medium text-foreground'
        )}
      >
        {isEmpty ? '—' : value}
      </dd>
    </div>
  )
}

/**
 * One attached document. Images render a real thumbnail — which also prints, so a
 * printed summary carries the passport photo rather than just its filename.
 */
function Attachment({ attachment, onPreview }) {
  const { label, file } = attachment
  const isImage = isPreviewableImage(file)
  const thumbnailUrl = useObjectUrl(isImage ? file : null)

  if (!file) {
    return (
      <div className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
          <FileText className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground/70">Not uploaded</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0 print:break-inside-avoid">
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-muted-foreground ring-1 ring-border">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" aria-hidden="true" className="size-full object-cover" />
        ) : (
          <FileText className="size-4" aria-hidden="true" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground" title={file.name}>
          {file.name}
          {file.size ? ` · ${formatBytes(file.size)}` : ''}
        </p>
      </div>

      {canPreview(file) ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 print:hidden"
          onClick={() => onPreview(attachment)}
        >
          <Eye />
          Preview
        </Button>
      ) : null}
    </div>
  )
}

export function AttachmentList({ attachments, onPreview }) {
  return (
    <div className="mt-2 sm:grid sm:grid-cols-2 sm:gap-x-10">
      {attachments.map((attachment) => (
        <Attachment key={attachment.key} attachment={attachment} onPreview={onPreview} />
      ))}
    </div>
  )
}
