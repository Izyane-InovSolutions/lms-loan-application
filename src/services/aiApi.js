import axios from 'axios'

// Served by this project's own api/ai/* functions, alongside the draft backend.
const aiApiClient = axios.create({ baseURL: import.meta.env.VITE_DRAFT_API_URL || '/api' })

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` })

// Model calls on a multi-page PDF routinely take 10–30 s; this only guards against a hang.
const ANALYZE_TIMEOUT_MS = 90000

export const analyzeDocument = (token, docType, file, { signal } = {}) => {
  const formData = new FormData()
  formData.append('docType', docType)
  formData.append('file', file)
  return aiApiClient
    .post('/ai/analyze-document', formData, { headers: authHeaders(token), signal, timeout: ANALYZE_TIMEOUT_MS })
    .then((r) => r.data)
}

export const prescreenApplication = (token, body, { signal, timeout = ANALYZE_TIMEOUT_MS } = {}) =>
  aiApiClient
    .post('/ai/prescreen', body, { headers: authHeaders(token), signal, timeout })
    .then((r) => r.data.prescreen)

/** No provider is configured on this deployment — hide AI features rather than erroring. */
export const isAiUnavailable = (error) => error?.response?.status === 503
