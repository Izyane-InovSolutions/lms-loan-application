import axios from 'axios'
import { requestOtp, verifyEmailOtp } from './draftApi'

const LMS_BASE_URL = import.meta.env.VITE_LMS_API_URL || '/erp-api'
const GET_APPLICATIONS_BY_EMAIL_METHOD =
  '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_application_by_email'

const lmsStatusClient = axios.create({ baseURL: LMS_BASE_URL })

export const requestStatusOtp = requestOtp

export const verifyStatusOtp = async (email, code) => {
  await verifyEmailOtp(email, code)
  const response = await lmsStatusClient.get(GET_APPLICATIONS_BY_EMAIL_METHOD, { params: { email } })
  return response.data?.message?.data ?? []
}

export const extractStatusErrorMessage = (error) =>
  error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.'
