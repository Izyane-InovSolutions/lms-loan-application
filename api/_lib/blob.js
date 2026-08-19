import { put as vercelPut, del as vercelDel } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'

// Read per call rather than once at module scope. A module-level snapshot is taken
// when the function instance boots, which is the wrong moment if the variable is
// marked Sensitive (absent at build time) — the snapshot captures undefined and every
// later request reports "no Blob store" while the dashboard plainly shows one set.
// Trimmed, because a variable defined with a blank or whitespace-only value is set as
// far as `Boolean` is concerned but useless as a credential — that reads as configured
// here and then fails deep inside the SDK as an opaque auth error instead.
const blobToken = () => (process.env.BLOB_READ_WRITE_TOKEN || '').trim()
const hasVercelBlob = () => blobToken().length > 0
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
// Token passed explicitly rather than left to the SDK's own env lookup, so the value
// validated above is the one actually used.
const putVercel = (pathname, data, options) =>
  vercelPut(pathname, data, { access: 'public', addRandomSuffix: true, token: blobToken(), ...options })

// Same trap as the KV fallback in kv.js: on Vercel the bundle directory is read-only,
// so putLocal fails every upload with `ENOENT ... mkdir '/var/task/.local-blob'` — a
// filesystem error that reads like a bug in the upload handler rather than a missing
// store. Name the actual cause instead of silently degrading to a dev-only code path.
const throwUnconfigured = () => {
  // Length only, never the value. A name that is present but blank means something is
  // defining it as empty — typically a manually added project variable shadowing the
  // one the linked Blob store injects.
  const raw = process.env.BLOB_READ_WRITE_TOKEN
  throw new Error(
    raw === undefined
      ? 'No Blob store is configured: BLOB_READ_WRITE_TOKEN is not set for this deployment. ' +
        'Link a Blob store (Vercel dashboard → Storage) and redeploy.'
      : `No Blob store is configured: BLOB_READ_WRITE_TOKEN is set but blank (length ${raw.length}). ` +
        'A Blob store is linked, so its token is being shadowed by an empty variable of the same ' +
        'name — delete that entry under Vercel → Settings → Environment Variables and redeploy.'
  )
}

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
  if (hasVercelBlob()) return putVercel(safePathname, data, options)
  if (process.env.VERCEL) return throwUnconfigured()
  return putLocal(safePathname, data)
}

export const deleteBlobsForDraft = async (draft) => {
  const urls = Object.values(draft?.documents || {})
    .map((ref) => ref?.url)
    .filter(Boolean)
  if (!urls.length) return
  if (hasVercelBlob()) {
    await vercelDel(urls, { token: blobToken() })
  } else if (!process.env.VERCEL) {
    await delLocal(urls)
  }
}
