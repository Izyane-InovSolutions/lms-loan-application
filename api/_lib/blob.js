import { put as vercelPut, del as vercelDel } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'

const hasVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const LOCAL_BLOB_DIR = path.resolve(process.cwd(), '.local-blob')
const LOCAL_BLOB_URL_PREFIX = '/local-blob/'

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

export const putBlob = (pathname, data, options = {}) =>
  hasVercelBlob ? putVercel(pathname, data, options) : putLocal(pathname, data)

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
