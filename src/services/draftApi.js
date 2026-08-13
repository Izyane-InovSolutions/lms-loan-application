import axios from 'axios'
import { injectFiles } from '../utils/fileTree'

const draftApiClient = axios.create({ baseURL: '/api' })

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } })

export const requestOtp = (email) => draftApiClient.post('/otp/request', { email }).then((r) => r.data)

export const verifyOtp = (email, code) => draftApiClient.post('/otp/verify', { email, code }).then((r) => r.data)

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
