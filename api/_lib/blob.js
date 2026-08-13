import { put, del } from '@vercel/blob'

// Vercel Blob only supports public-access objects today; URLs are unguessable
// (random suffix) rather than access-controlled, so treat the URL itself as the secret.
export const putBlob = (pathname, data, options = {}) =>
  put(pathname, data, { access: 'public', addRandomSuffix: true, ...options })

export const deleteBlobsForDraft = async (draft) => {
  const urls = Object.values(draft?.documents || {})
    .map((ref) => ref?.url)
    .filter(Boolean)
  if (urls.length) {
    await del(urls)
  }
}
