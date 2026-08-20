import { useEffect, useState } from 'react'

/**
 * Object URL for a File, revoked when the file changes or the component unmounts.
 *
 * Pass null to hold nothing — callers use that to avoid minting a URL for a preview
 * that is not currently open.
 */
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!file || (typeof Blob !== 'undefined' && !(file instanceof Blob))) {
      setUrl(null)
      return undefined
    }

    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url
}

export const isPreviewableImage = (file) => Boolean(file?.type?.startsWith('image/'))

export const isPreviewablePdf = (file) =>
  file?.type === 'application/pdf' || Boolean(file?.name?.toLowerCase().endsWith('.pdf'))

export const canPreview = (file) => isPreviewableImage(file) || isPreviewablePdf(file)

export const formatBytes = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
