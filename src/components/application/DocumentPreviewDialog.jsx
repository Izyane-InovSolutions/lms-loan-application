import React from 'react'
import { Download, ExternalLink, FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useObjectUrl, isPreviewableImage, isPreviewablePdf, formatBytes } from '@/hooks/useObjectUrl'

/**
 * Renders an attached document in place.
 *
 * Files live in memory as File objects (freshly picked, or rebuilt from Blob storage
 * on a resumed draft), so previewing is just an object URL — nothing is uploaded to
 * show it. The URL is only minted while the dialog is open.
 *
 * Laid out as a near-fullscreen lightbox rather than a form-sized modal: bank
 * statements and PACRA certificates are multi-page documents, and the browser's own
 * PDF viewer needs real estate before it is usable. The viewer fills all the height
 * left over between the header and footer.
 */
export function DocumentPreviewDialog({ open, onOpenChange, attachment }) {
  const file = open ? attachment?.file : null
  const url = useObjectUrl(file)

  const isImage = isPreviewableImage(attachment?.file)
  const isPdf = isPreviewablePdf(attachment?.file)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,60rem)] w-[min(96vw,80rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3.5 pr-14">
          <DialogTitle className="text-base">{attachment?.label}</DialogTitle>
          <DialogDescription className="truncate" title={attachment?.file?.name}>
            {attachment?.file?.name}
            {attachment?.file?.size ? ` · ${formatBytes(attachment.file.size)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* min-h-0 lets this flex child actually shrink, so the viewer gets a bounded
            height instead of pushing the footer off-screen. */}
        <div className="min-h-0 flex-1 bg-secondary/40">
          {!url ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading preview…</div>
          ) : isImage ? (
            <div className="h-full overflow-auto p-4">
              <img src={url} alt={attachment.label} className="mx-auto max-h-full w-auto object-contain" />
            </div>
          ) : isPdf ? (
            <iframe src={url} title={`${attachment.label} preview`} className="size-full border-0" />
          ) : (
            <div className="grid h-full place-content-center justify-items-center gap-3 p-6 text-center">
              <FileQuestion className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-sm text-sm text-muted-foreground">
                This file type cannot be previewed in the browser. Download it to view.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
          {url ? (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={url} download={attachment?.file?.name}>
                  <Download />
                  Download
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open in new tab
                </a>
              </Button>
            </>
          ) : null}
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
