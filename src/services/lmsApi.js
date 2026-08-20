import axios from 'axios'

const BASE_URL = import.meta.env.VITE_LMS_API_URL || '/erp-api'

// TODO(security): admin creds ship to the browser; move behind a backend proxy before production
const ADMIN_USR = 'Administrator'
const ADMIN_PWD = 'root'

/*
 * Timeouts are per-call rather than global, because these endpoints differ by an
 * order of magnitude. Measured against the live server: login ~2.5s, the read-only
 * list ~4s. Uploads depend on file size and link quality; creating an application is
 * the slowest by far (it attaches every uploaded document server-side).
 *
 * These exist to stop a dead connection hanging forever — they are NOT a latency
 * budget. Set them too tight and a slow-but-successful submit gets aborted, which is
 * strictly worse than waiting, since the submit cannot be safely retried.
 */
const TIMEOUT_DEFAULT_MS = 30000
const TIMEOUT_UPLOAD_MS = 120000
const TIMEOUT_SUBMIT_MS = 180000

const lmsApi = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_DEFAULT_MS,
})

/*
 * Retry policy.
 *
 * The link to the LMS host is lossy — a meaningful share of TCP connections never
 * complete, while a retry moments later succeeds. Submitting an application is a
 * chain of sequential calls (login → one upload per document → create), so without
 * retries the odds of every request landing are poor even though the server is fine.
 *
 * Only calls that are safe to repeat are retried:
 *   login / get           idempotent
 *   upload_file           a repeat orphans a file server-side; only the URL we
 *                         actually receive is ever attached to the application
 *   create_application    NOT retried — see createLoanApplication below
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
])

const RETRYABLE_STATUSES = new Set([502, 503, 504])

const isRetryable = (error) => {
  if (axios.isCancel?.(error)) return false
  // A response means the server was reached; only transient gateway errors are worth repeating.
  if (error?.response) return RETRYABLE_STATUSES.has(error.response.status)
  return RETRYABLE_ERROR_CODES.has(error?.code) || error?.message === 'Network Error'
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 600

/** Runs `operation`, repeating it on transient network failures with exponential backoff. */
const withRetry = async (operation, { attempts = MAX_ATTEMPTS } = {}) => {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === attempts || !isRetryable(error)) break
      // Jitter avoids several parallel uploads retrying in lockstep.
      await wait(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 300)
    }
  }

  throw lastError
}

let sessionId = null
let loginPromise = null

// The login response nests the session id at message.data.sid. This backend hands the
// sid back in the JSON body (rather than relying on a cross-site cookie), so every
// subsequent call resends it as a `sid` query param.
export const ensureLogin = () => {
  if (sessionId) {
    return Promise.resolve(sessionId)
  }
  if (!loginPromise) {
    loginPromise = withRetry(() =>
      lmsApi.post('/api/method/auth_api.user_management.api.auth.login', null, {
        params: { usr: ADMIN_USR, pwd: ADMIN_PWD },
      })
    )
      .then((response) => {
        const sid = response.data?.message?.data?.sid
        if (!sid) {
          throw new Error('Login succeeded but no session id was returned.')
        }
        sessionId = sid
        return sessionId
      })
      .catch((error) => {
        loginPromise = null
        throw error
      })
  }
  return loginPromise
}

export const uploadFile = async (file, { isPrivate = true } = {}) => {
  const sid = await ensureLogin()
  const response = await withRetry(() => {
    // Rebuilt per attempt: a FormData carrying a stream cannot be replayed reliably.
    const formData = new FormData()
    formData.append('file', file)
    formData.append('is_private', isPrivate ? 1 : 0)
    return lmsApi.post('/api/method/upload_file', formData, { params: { sid }, timeout: TIMEOUT_UPLOAD_MS })
  }, { attempts: 3 })
  return response.data?.message?.file_url
}

/**
 * Submits the application. Deliberately NOT retried.
 *
 * When a request fails without a response we cannot tell whether it never arrived or
 * whether it was processed and the reply was lost. Repeating it risks filing the same
 * loan twice, so the failure is surfaced and the applicant is asked to check before
 * resubmitting. Making this safely retryable needs an idempotency key honoured by the
 * Frappe endpoint.
 */
export const createLoanApplication = async (payload) => {
  const sid = await ensureLogin()
  try {
    const response = await lmsApi.post(
      '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.create_custom_loan_application',
      payload,
      { params: { sid }, timeout: TIMEOUT_SUBMIT_MS }
    )
    return response.data?.message
  } catch (error) {
    if (!error?.response) {
      error.isUncertainSubmission = true
    }
    throw error
  }
}

export const getLoanApplications = async () => {
  const sid = await ensureLogin()
  const response = await withRetry(() =>
    lmsApi.get(
      '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_applications',
      { params: { sid } }
    )
  )
  return response.data?.message ?? response.data?.data ?? response.data
}

export const getLoanApplicationsByEmail = async (email) => {
  const sid = await ensureLogin()
  try {
    const response = await withRetry(() =>
      lmsApi.get(
        '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_application_by_email',
        { params: { email, sid } }
      )
    )
    return response.data?.message?.data ?? response.data?.data ?? []
  } catch (error) {
    const serverMessage = error?.response?.data?.message?.message || error?.response?.data?.message
    if (error?.response?.status === 404 && typeof serverMessage === 'string' && serverMessage.includes('No Custom Loan Application found')) {
      return []
    }
    throw error
  }
}

export const downloadLoanApplicationFile = async (filePath) => {
  const sid = await ensureLogin()
  const response = await withRetry(() =>
    lmsApi.get(filePath.replace(/^\/+/, ''), { params: { sid }, responseType: 'blob' })
  )
  return response.data
}

export const extractErrorMessage = (error) => {
  // No confirmation came back — whether the connection dropped or the server simply
  // took too long, the outcome is genuinely unknown. Say so rather than inviting a
  // blind retry that could file a duplicate application.
  if (error?.isUncertainSubmission) {
    return 'We did not get a confirmation back from the server, so we cannot tell whether your application was received. Please check your applications before submitting again.'
  }

  if (!error?.response && isRetryable(error)) {
    return 'We could not reach the server. Check your connection and try again.'
  }

  const serverMessages = error?.response?.data?._server_messages
  if (serverMessages) {
    try {
      const parsed = JSON.parse(serverMessages)
      const first = Array.isArray(parsed) ? parsed[0] : null
      if (first) {
        const inner = JSON.parse(first)
        if (inner?.message) return inner.message
      }
    } catch {
      // fall through to other message sources
    }
  }
  return (
    error?.response?.data?.message ||
    error?.response?.data?.exception ||
    error?.message ||
    'Something went wrong. Please try again.'
  )
}

export default lmsApi
