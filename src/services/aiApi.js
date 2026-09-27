import axios from 'axios'

// Served by this project's own api/ai/* functions, alongside the draft backend.
const aiApiClient = axios.create({ baseURL: import.meta.env.VITE_DRAFT_API_URL || '/api' })

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` })

// Model calls on a multi-page PDF routinely take 10–30 s; this only guards against a hang.
const ANALYZE_TIMEOUT_MS = 90000

export const analyzeDocument = (token, docType, file, { signal, fieldKey } = {}) => {
  const formData = new FormData()
  formData.append('docType', docType)
  // Lets the server keep this result for the submitted application.
  if (fieldKey) formData.append('fieldKey', fieldKey)
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
export const isAiUnavailable = (error) => {
  const { status, data } = error?.response || {}
  // Older deployments answer 503 without a code; a coded 503 may be a provider outage.
  return status === 503 && (!data?.code || data.code === 'ai_unavailable')
}

/**
 * Why a check failed, as one of:
 *   invalid_token         the draft token is unknown; the draft hook fetches a new one
 *   provider_unavailable  the model provider is out of credit or overloaded
 *   quota_exceeded        this applicant's daily check limit is used up
 *   file_too_large        over the upload cap
 *   timeout               no answer in time, or the connection dropped
 *   failed                anything else
 */
export const aiFailureReason = (error) => {
  const response = error?.response
  if (!response) return 'timeout'
  const code = response.data?.code
  if (response.status === 401) return 'invalid_token'
  if (code === 'provider_unavailable' || code === 'quota_exceeded' || code === 'file_too_large' || code === 'timeout') {
    return code
  }
  if (response.status === 413) return 'file_too_large'
  if (response.status === 429) return 'quota_exceeded'
  if (response.status === 504) return 'timeout'
  return 'failed'
}

const FAILURE_MESSAGES = {
  invalid_token: 'Reconnecting so this can be checked…',
  provider_unavailable: 'Automatic checks are unavailable right now.',
  quota_exceeded: 'You’ve reached today’s limit for automatic checks.',
  file_too_large: 'This file is too large to check automatically.',
  timeout: 'The check timed out or the connection dropped.',
  failed: 'We couldn’t check this automatically.',
}

export const aiFailureMessage = (reason) => FAILURE_MESSAGES[reason] || FAILURE_MESSAGES.failed

/** Worth offering "Try again" for. A token problem resolves by itself; the others will not change on retry. */
export const isRetryableAiFailure = (reason) => ['provider_unavailable', 'timeout', 'failed'].includes(reason)

/** Failures that will hit every request the same way, so further calls are paused until a retry. */
export const pausesAiChecks = (reason) => reason === 'provider_unavailable' || reason === 'quota_exceeded'
