import axios from 'axios'
import { requestOtp, verifyEmailOtp } from './draftApi'

const LMS_BASE_URL = import.meta.env.VITE_LMS_API_URL || '/erp-api'
const GET_APPLICATIONS_BY_EMAIL_METHOD =
  '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_application_by_email'

const lmsStatusClient = axios.create({ baseURL: LMS_BASE_URL })

export const requestStatusOtp = requestOtp

export const verifyStatusOtp = async (email, code) => {
  await verifyEmailOtp(email, code)
  try {
    const response = await lmsStatusClient.get(GET_APPLICATIONS_BY_EMAIL_METHOD, { params: { email } })
    return response.data?.message?.data ?? []
  } catch (error) {
    // The LMS API responds 404 with no `data` when the email has no applications at
    // all, rather than 200 with an empty list — treat both the same way.
    if (error?.response?.status === 404) return []
    throw error
  }
}

export const extractStatusErrorMessage = (error) => {
  const message = error?.response?.data?.message
  if (typeof message === 'string') return message
  if (typeof message?.message === 'string') return message.message
  return error?.message || 'Something went wrong. Please try again.'
}
