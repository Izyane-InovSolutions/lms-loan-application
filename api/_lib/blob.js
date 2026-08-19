import { put as vercelPut, del as vercelDel } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'

const hasVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const LOCAL_BLOB_DIR = path.resolve(process.cwd(), '.local-blob')
const LOCAL_BLOB_URL_PREFIX = '/local-blob/'

/*
 * Storage keys are built from a client-supplied fieldKey and the uploaded filename,
 * so they are sanitised before use:
 *
 *  - Length: a filesystem path component caps at 255 bytes, and browser-generated
 *    download names routinely exceed that (a Google Docs export blew past it and
 *    failed every upload with ENAMETOOLONG). Segments are capped, extension kept.
 *  - Traversal: fieldKey arrives from the browser, so `..` is collapsed rather than
 *    trusted — otherwise a crafted key could escape the blob directory locally.
 *
 * Only the storage key is affected; the draft record keeps the original filename, so
 * applicants still see the name they uploaded.
 */
const MAX_SEGMENT_LENGTH = 120

const sanitizeSegment = (segment, isFilename) => {
  const cleaned = String(segment)
    .replace(/[^A-Za-z0-9._@-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  const safe = cleaned || 'file'
  if (safe.length <= MAX_SEGMENT_LENGTH) return safe
  if (!isFilename) return safe.slice(0, MAX_SEGMENT_LENGTH)

  const dot = safe.lastIndexOf('.')
  const extension = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : ''
  return safe.slice(0, MAX_SEGMENT_LENGTH - extension.length) + extension
}

export const sanitizePathname = (pathname) => {
  const segments = String(pathname).split('/').filter(Boolean)
  return segments.map((segment, index) => sanitizeSegment(segment, index === segments.length - 1)).join('/')
}

// Vercel Blob only supports public-access objects today; URLs are unguessable
// (random suffix) rather than access-controlled, so treat the URL itself as the secret.
const putVercel = (pathname, data, options) =>
  vercelPut(pathname, data, { access: 'public', addRandomSuffix: true, ...options })

// Local dev fallback (no BLOB_READ_WRITE_TOKEN configured): write to disk and serve
// via the /local-blob/* static middleware registered in vite.config.js.
const putLocal = async (pathname, data) => {
  const filePath = path.join(LOCAL_BLOB_DIR, pathname)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, data)
  return { url: `${LOCAL_BLOB_URL_PREFIX}${pathname}`, pathname }
}

const delLocal = async (urls) => {
  await Promise.all(
    urls.map((url) =>
      fs.rm(path.join(LOCAL_BLOB_DIR, url.replace(LOCAL_BLOB_URL_PREFIX, '')), { force: true })
    )
  )
}

export const putBlob = (pathname, data, options = {}) => {
  const safePathname = sanitizePathname(pathname)
  return hasVercelBlob ? putVercel(safePathname, data, options) : putLocal(safePathname, data)
}

export const deleteBlobsForDraft = async (draft) => {
  const urls = Object.values(draft?.documents || {})
    .map((ref) => ref?.url)
    .filter(Boolean)
  if (!urls.length) return
  if (hasVercelBlob) {
    await vercelDel(urls)
  } else {
    await delLocal(urls)
  }
}
