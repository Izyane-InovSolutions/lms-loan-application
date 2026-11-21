import kv from '../_lib/kv.js'
import { fail } from '../_lib/http.js'
import { sendOtpEmail } from '../_lib/email.js'
import { generateOtpCode } from '../_lib/token.js'
import { checkOtp, consumeOtp, otpKey, storeOtp } from '../_lib/otp.js'
import { ipOf, rateKey, underLimit } from '../_lib/rateLimit.js'
import { getSms } from '../_lib/sms.js'
import { isDeployed } from '../_lib/runtime.js'
import { CHANNELS, issueTicket, normaliseEmail, normalisePhone, subjectFor } from '../_lib/verification.js'

/*
 * The applicant's code when they start an application (api/_lib/verification.js):
 *
 *   POST /verification/start  { channel: 'email' | 'phone', email?, phone? }        → { sent: true }
 *   POST /verification/check  { channel, email?, phone?, code }                      → { ticket }
 *
 * Public, so limited as api/otp/request.js is: a short wait between codes, and caps per
 * caller and per contact.
 */

const COOLDOWN_MS = 60 * 1000
const MAX_PER_IP_PER_HOUR = 30
const MAX_PER_CONTACT_PER_DAY = 15
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const contactFrom = (body) => {
  const channel = body?.channel
  if (!CHANNELS.includes(channel)) fail(400, 'Choose email or phone.', 'invalid_input')
  if (channel === 'email') {
    const email = normaliseEmail(body.email)
    if (!email || !EMAIL_PATTERN.test(email)) fail(400, 'Enter a valid email address.', 'invalid_input')
    return { channel, value: email }
  }
  const phone = normalisePhone(body.phone)
  if (!phone) fail(400, 'Enter a valid Zambian mobile number.', 'invalid_input')
  return { channel, value: phone }
}

const start = async (req) => {
  const { channel, value } = contactFrom(req.body)
  const sms = channel === 'phone' ? await getSms() : null
  if (channel === 'phone' && !sms) fail(400, 'Codes can’t be sent by text message here. Use your email instead.', 'sms_unavailable')
  const subject = subjectFor(channel, value)
  const existing = await kv.get(otpKey('start', subject))
  if (existing && Date.now() - existing.createdAt < COOLDOWN_MS) fail(429, 'Please wait a moment before asking for another code.', 'too_soon')
  if (
    !(await underLimit(rateKey('verify-start-ip', ipOf(req)), MAX_PER_IP_PER_HOUR, 60 * 60)) ||
    !(await underLimit(rateKey('verify-start-contact', subject), MAX_PER_CONTACT_PER_DAY, 24 * 60 * 60))
  ) {
    fail(429, 'Too many codes requested. Please try again later.', 'rate_limited')
  }

  const code = generateOtpCode()
  await storeOtp('start', subject, code)
  try {
    if (channel === 'email') await sendOtpEmail(value, code, { purpose: 'start' })
    else await sms.send(value, `Your code to start your loan application is ${code}. It expires in 10 minutes. Don't share it with anyone.`)
  } catch (error) {
    // Local testing without mail or SMS: LOS_DEV_LOG_CODES=true prints it instead. Never on a deployment.
    if (process.env.LOS_DEV_LOG_CODES === 'true' && !isDeployed()) {
      console.warn(`[dev] could not send to ${value}; their start code is ${code}`)
      return { sent: true }
    }
    await consumeOtp('start', subject)
    fail(502, channel === 'email' ? 'We couldn’t send the email. Please try again.' : 'We couldn’t send the text message. Try again, or use your email.', 'send_failed')
  }
  return { sent: true }
}

const check = async (req) => {
  const { channel, value } = contactFrom(req.body)
  const subject = subjectFor(channel, value)
  const problem = await checkOtp({ email: subject, code: req.body?.code, purpose: 'start', req })
  if (problem) fail(problem.status, problem.message, problem.status === 429 ? 'rate_limited' : 'invalid_code')
  await consumeOtp('start', subject)
  return { ticket: await issueTicket(channel, value), channel, value }
}

export const verificationRoutes = [
  ['POST', '/verification/start', start],
  ['POST', '/verification/check', check],
]
