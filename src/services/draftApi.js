import axios from 'axios'
import { injectFiles } from '../utils/fileTree'

// The draft mini-backend is this project's own api/* functions, served at /api in dev
// (localApiDevPlugin in vite.config.js) and on Vercel alike — never /erp-api, which
// rewrites to the external LMS host and has no draft/otp routes.
const draftApiBaseUrl = import.meta.env.VITE_DRAFT_API_URL || '/api'
const draftApiClient = axios.create({ baseURL: draftApiBaseUrl })

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
    .post('/draft/documents', formData, authHeaders(token))
    .then((r) => r.data)
}

// Downloads each stored document from Blob storage and rebuilds it as a real File,
// so the restored draft slots straight into the same personalData/businessData shape
// the rest of DashboardPage already expects (uploads, previews, validation unchanged).
export const hydrateDraftFiles = async (draft) => {
  const entries = Object.entries(draft.documents || {})
  const filesByPath = new Map()

  await Promise.all(
    entries.map(async ([path, ref]) => {
      const response = await fetch(ref.url)
      const blob = await response.blob()
      filesByPath.set(path, new File([blob], ref.filename, { type: ref.contentType }))
    })
  )

  return {
    ...draft,
    personalData: injectFiles(draft.personalData, filesByPath),
    businessData: injectFiles(draft.businessData, filesByPath),
  }
}

export const extractDraftErrorMessage = (error) =>
  error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.'
