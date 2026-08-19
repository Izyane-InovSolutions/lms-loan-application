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

  try {
    await sendOtpEmail(email, code)
  } catch (error) {
    await kv.del(otpKey)
    return res.status(502).json({ message: 'Could not send the verification email. Please try again.' })
  }

  return res.status(200).json({ message: 'OTP sent.' })
}
