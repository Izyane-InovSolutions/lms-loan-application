import kv from '../_lib/kv.js'
import { sendOtpEmail } from '../_lib/email.js'
import { normalizeEmail, generateOtpCode } from '../_lib/token.js'
import { OTP_PURPOSES, otpKey, storeOtp } from '../_lib/otp.js'
import { ipOf, rateKey, underLimit } from '../_lib/rateLimit.js'
import { getSessionUser } from '../_lib/auth/sessions.js'
import { isStaffRole } from '../../src/config/roles.js'
import { isDeployed } from '../_lib/runtime.js'

const OTP_COOLDOWN_MS = 60 * 1000
// Enough for an office of agents behind one address; stops one client mailing the world.
const MAX_REQUESTS_PER_IP_PER_HOUR = 30
const MAX_REQUESTS_PER_EMAIL_PER_DAY = 15

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = normalizeEmail(req.body?.email)
  if (!email) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }

  // "resume": continue an application. "login": sign in to My applications. "consent": an
  // agent is filling in an application with this customer, who reads the code back to
  // confirm they agree. "offer": accepting an offer in person with staff. "sign": the
  // customer signing their offer themselves. Each is only accepted by its own check.
  const purpose = OTP_PURPOSES.includes(req.body?.purpose) ? req.body.purpose : 'resume'
  const key = otpKey(purpose, email)
  const existing = await kv.get(key)
  if (existing && Date.now() - existing.createdAt < OTP_COOLDOWN_MS) {
    return res.status(429).json({ message: 'Please wait a moment before requesting another code.' })
  }
  if (
    !(await underLimit(rateKey('otp-request-ip', ipOf(req)), MAX_REQUESTS_PER_IP_PER_HOUR, 60 * 60)) ||
    !(await underLimit(rateKey('otp-request-email', email), MAX_REQUESTS_PER_EMAIL_PER_DAY, 24 * 60 * 60))
  ) {
    return res.status(429).json({ message: 'Too many codes requested. Please try again later.' })
  }

  const code = generateOtpCode()
  await storeOtp(purpose, email, code)

  // The agent named in the email is whoever is signed in, never a name from the request:
  // anyone can call this endpoint, and the email must not vouch for a made-up agent.
  const session = ['consent', 'offer'].includes(purpose) ? await getSessionUser(req).catch(() => null) : null
  const agentName = session && isStaffRole(session.role) ? session.name : ''
  try {
    await sendOtpEmail(email, code, { purpose, agentName })
  } catch (error) {
    // Local testing without a mail server: LOS_DEV_LOG_CODES=true prints the code to the
    // server console instead. Never honoured on a deployment.
    if (process.env.LOS_DEV_LOG_CODES === 'true' && !isDeployed()) {
      console.warn(`[dev] could not email ${email}; their ${purpose} code is ${code}`)
      return res.status(200).json({ message: 'OTP sent.' })
    }
    await kv.del(key)
    return res.status(502).json({ message: 'Could not send the verification email. Please try again.' })
  }

  return res.status(200).json({ message: 'OTP sent.' })
}
