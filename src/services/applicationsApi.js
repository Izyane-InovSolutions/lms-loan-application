import axios from 'axios'

/*
 * The loan workspace API (/api/v1) as the public wizard uses it. Same-origin, so a staff
 * member's session cookie travels along when they fill in an application for a customer.
 */
const client = axios.create({ baseURL: '/api/v1' })

/** Files the application. Safe to retry with the same `submissionKey`. */
export const submitApplication = (draftToken, body) =>
  client.post('/applications', body, { headers: { Authorization: `Bearer ${draftToken}` }, timeout: 120000 }).then((r) => r.data)

/** Form values from the applicant's previous application of this type, or null. */
export const fetchPrefill = (email, type) =>
  client.get('/prefill', { params: { email, type } }).then((r) => r.data.formState)

/** Who a referral code belongs to (first name and role), or null. */
export const fetchReferrer = (code) =>
  client.get(`/referrals/${encodeURIComponent(code)}`).then((r) => r.data.referrer).catch(() => null)

/** The signed-in person, if any — used by the wizard to recognise an agent filling it in. */
export const fetchSession = () => client.get('/auth/me').then((r) => r.data.user).catch(() => null)

/** Emails the customer a code they read back to the agent to confirm the application. */
export const requestConsentCode = (email, agentName) =>
  axios.post('/api/otp/request', { email, purpose: 'consent', agentName }).then((r) => r.data)

export const extractApiError = (error) =>
  error?.response?.data?.message ||
  (error?.response ? 'Something went wrong. Please try again.' : 'We could not reach the server. Check your connection and try again.')
