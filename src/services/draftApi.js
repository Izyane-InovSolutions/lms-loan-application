import axios from 'axios'
import { injectFiles } from '../utils/fileTree'

// The draft mini-backend is this project's own api/* functions, served at /api in dev
// (localApiDevPlugin in vite.config.js) and on Vercel alike.
const draftApiBaseUrl = import.meta.env.VITE_DRAFT_API_URL || '/api'
// Without a timeout a request the server never answers hangs forever, and Submit and
// "Save & exit" both wait on a draft save. Uploads get longer: a 4 MB statement over a
// slow mobile connection legitimately takes a while.
const DRAFT_REQUEST_TIMEOUT_MS = 20000
const DRAFT_UPLOAD_TIMEOUT_MS = 90000
const draftApiClient = axios.create({ baseURL: draftApiBaseUrl, timeout: DRAFT_REQUEST_TIMEOUT_MS })

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } })

export const requestOtp = (email) => draftApiClient.post('/otp/request', { email }).then((r) => r.data)

export const verifyOtp = (email, code) => draftApiClient.post('/otp/verify', { email, code }).then((r) => r.data)

// Same code, checked without requiring an in-progress draft — for flows that only need
// to confirm the caller owns the email address (e.g. looking up submitted applications).
export const verifyEmailOtp = (email, code) =>
  draftApiClient.post('/otp/verify-email', { email, code }).then((r) => r.data)

export const createDraft = (payload) => draftApiClient.post('/draft', payload).then((r) => r.data)

export const updateDraft = (token, payload) =>
  draftApiClient.put('/draft', payload, authHeaders(token)).then((r) => r.data)

export const deleteDraft = (token) => draftApiClient.delete('/draft', authHeaders(token)).then((r) => r.data)

export const uploadDraftDocument = (token, fieldKey, file) => {
  const formData = new FormData()
  formData.append('fieldKey', fieldKey)
  formData.append('file', file)
  return draftApiClient
    .post('/draft/documents', formData, { ...authHeaders(token), timeout: DRAFT_UPLOAD_TIMEOUT_MS })
    .then((r) => r.data)
}

// Downloads each stored document through /api/v1/drafts/file (authorised by the draft
// token, so it works with a private Blob store) and rebuilds it as a real File, so the
// restored draft slots straight into the same personalData/businessData shape the rest of
// DashboardPage already expects (uploads, previews, validation unchanged).
export const hydrateDraftFiles = async (draft, token) => {
  const entries = Object.entries(draft.documents || {})
  const filesByPath = new Map()

  await Promise.all(
    entries.map(async ([path, ref]) => {
      // A file that has gone from storage, or doesn't arrive in time, is simply not
      // restored; the applicant re-attaches it rather than waiting on a resume forever.
      try {
        const response = await fetch(`/api/v1/drafts/file?path=${encodeURIComponent(path)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(DRAFT_UPLOAD_TIMEOUT_MS),
        })
        if (!response.ok) return
        const blob = await response.blob()
        filesByPath.set(path, new File([blob], ref.filename, { type: ref.contentType }))
      } catch {
        // Left out, as above.
      }
    })
  )

  return {
    ...draft,
    personalData: injectFiles(draft.personalData, filesByPath),
    businessData: injectFiles(draft.businessData, filesByPath),
  }
}

export const extractDraftErrorMessage = (error) =>
  error?.response?.data?.message ||
  (error?.code === 'ECONNABORTED' ? 'The server took too long to respond. Please try again.' : null) ||
  error?.message ||
  'Something went wrong. Please try again.'

/**
 * The 409 reason codes from /api/draft: `draft_exists` (POST — this email already has an
 * application in progress that the caller holds no token for) and `email_in_use` (PUT —
 * the new email belongs to a different application in progress). Null for anything else.
 */
export const draftConflictCode = (error) => {
  if (error?.response?.status !== 409) return null
  const code = error.response.data?.code
  return code === 'draft_exists' || code === 'email_in_use' ? code : null
}
