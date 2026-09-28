import { put as vercelPut, del as vercelDel, get as vercelGet, copy as vercelCopy } from '@vercel/blob'
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
// A store is created public or private and cannot change. Set BLOB_ACCESS=private when
// the linked store is private (recommended: these are NRCs and bank statements). Reads
// then always go through our own authenticated routes; the URL alone opens nothing.
const blobAccess = () => ((process.env.BLOB_ACCESS || '').trim() === 'private' ? 'private' : 'public')
// LOS_LOCAL_BLOB_DIR lets tests write somewhere disposable.
const LOCAL_BLOB_DIR = process.env.LOS_LOCAL_BLOB_DIR || path.resolve(process.cwd(), '.local-blob')
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

// On a public store the random suffix makes URLs unguessable rather than
// access-controlled, so the URL itself is the secret — it is never sent to a browser that
// is not allowed the file. Token passed explicitly rather than left to the SDK's own env
// lookup, so the value validated above is the one actually used.
const putVercel = (pathname, data, options) =>
  vercelPut(pathname, data, { access: blobAccess(), addRandomSuffix: true, token: blobToken(), ...options })

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

/** The store pathname of a stored file, from its record (older draft records only kept the URL). */
export const blobPathname = (ref) => {
  if (ref?.pathname) return ref.pathname
  const url = String(ref?.url || '')
  if (url.startsWith(LOCAL_BLOB_URL_PREFIX)) return url.slice(LOCAL_BLOB_URL_PREFIX.length)
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1))
  } catch {
    return url
  }
}

/** Reads a stored file into memory, or null if it is gone. Files are capped at 4.5 MB, so buffering is fine. */
export const readBlob = async (ref) => {
  if (hasVercelBlob()) {
    const result = await vercelGet(ref.url || blobPathname(ref), { access: blobAccess(), token: blobToken() })
    if (!result || result.statusCode !== 200) return null
    const data = Buffer.from(await new Response(result.stream).arrayBuffer())
    return { data, contentType: result.blob.contentType }
  }
  if (process.env.VERCEL) return throwUnconfigured()
  try {
    const data = await fs.readFile(path.join(LOCAL_BLOB_DIR, blobPathname(ref)))
    return { data, contentType: ref.contentType || null }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** Copies a stored file to a new pathname (server-side on Vercel — nothing is downloaded). */
export const copyBlob = async (ref, toPathname) => {
  const safePathname = sanitizePathname(toPathname)
  if (hasVercelBlob()) {
    const result = await vercelCopy(ref.url || blobPathname(ref), safePathname, {
      access: blobAccess(),
      addRandomSuffix: true,
      token: blobToken(),
      ...(ref.contentType ? { contentType: ref.contentType } : {}),
    })
    return { url: result.url, pathname: result.pathname }
  }
  if (process.env.VERCEL) return throwUnconfigured()
  const target = path.join(LOCAL_BLOB_DIR, safePathname)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(path.join(LOCAL_BLOB_DIR, blobPathname(ref)), target)
  return { url: `${LOCAL_BLOB_URL_PREFIX}${safePathname}`, pathname: safePathname }
}

export const deleteBlobs = async (refs) => {
  const urls = refs.map((ref) => ref?.url).filter(Boolean)
  if (!urls.length) return
  if (hasVercelBlob()) {
    await vercelDel(urls, { token: blobToken() })
  } else if (!process.env.VERCEL) {
    await delLocal(urls)
  }
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
