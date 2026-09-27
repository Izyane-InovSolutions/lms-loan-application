import kv from '../_lib/kv.js'
import { sendOtpEmail } from '../_lib/email.js'
import { normalizeEmail, generateOtpCode } from '../_lib/token.js'

const OTP_TTL_SECONDS = 600
const OTP_COOLDOWN_MS = 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = normalizeEmail(req.body?.email)
  if (!email) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }

  const otpKey = `otp:${email}`
  const existing = await kv.get(otpKey)
  if (existing && Date.now() - existing.createdAt < OTP_COOLDOWN_MS) {
    return res.status(429).json({ message: 'Please wait a moment before requesting another code.' })
  }

  const code = generateOtpCode()
  await kv.set(otpKey, { code, attempts: 0, createdAt: Date.now() }, { ex: OTP_TTL_SECONDS })

  // "consent": an agent is filling in an application with this customer, who reads the
  // code back to confirm they agree. The wording has to say so, not "resume".
  const purpose = ['consent', 'offer'].includes(req.body?.purpose) ? req.body.purpose : 'resume'
  try {
    await sendOtpEmail(email, code, { purpose, agentName: String(req.body?.agentName || '').slice(0, 80) })
  } catch (error) {
    // Local testing without a mail server: LOS_DEV_LOG_CODES=true prints the code to the
    // server console instead. Never honoured on Vercel.
    if (process.env.LOS_DEV_LOG_CODES === 'true' && !process.env.VERCEL) {
      console.warn(`[dev] could not email ${email}; their code is ${code}`)
      return res.status(200).json({ message: 'OTP sent.' })
    }
    await kv.del(otpKey)
    return res.status(502).json({ message: 'Could not send the verification email. Please try again.' })
  }

  return res.status(200).json({ message: 'OTP sent.' })
}
