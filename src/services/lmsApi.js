import axios from 'axios'

const BASE_URL = import.meta.env.VITE_LMS_API_URL || '/erp-api'

// TODO(security): admin creds ship to the browser; move behind a backend proxy before production
const ADMIN_USR = 'Administrator'
const ADMIN_PWD = 'root'

const lmsApi = axios.create({
  baseURL: BASE_URL,
})

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
    loginPromise = lmsApi
      .post('/api/method/auth_api.user_management.api.auth.login', null, {
        params: { usr: ADMIN_USR, pwd: ADMIN_PWD },
      })
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
  const formData = new FormData()
  formData.append('file', file)
  formData.append('is_private', isPrivate ? 1 : 0)
  const response = await lmsApi.post('/api/method/upload_file', formData, { params: { sid } })
  return response.data?.message?.file_url
}

export const createLoanApplication = async (payload) => {
  const sid = await ensureLogin()
  const response = await lmsApi.post(
    '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.create_custom_loan_application',
    payload,
    { params: { sid } }
  )
  return response.data?.message
}

export const getLoanApplications = async () => {
  const sid = await ensureLogin()
  const response = await lmsApi.get(
    '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_applications',
    { params: { sid } }
  )
  return response.data?.message ?? response.data?.data ?? response.data
}

export const extractErrorMessage = (error) => {
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
