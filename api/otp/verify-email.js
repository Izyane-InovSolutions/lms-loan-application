import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { normalizeEmail } from '../_lib/token.js'

// Same OTP check (api/_lib/otp.js) as ./verify.js, without the draft lookup — this just confirms the
// caller owns the email address, for flows that aren't resuming a draft (e.g. looking
// up submitted applications).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = normalizeEmail(req.body?.email)
  const code = String(req.body?.code || '').trim()
  if (!email || !code) {
    return res.status(400).json({ message: 'Email and code are required.' })
  }

  const otpError = await checkOtp(email, code)
  if (otpError) {
    return res.status(otpError.status).json({ message: otpError.message })
  }

  await consumeOtp(email)
  return res.status(200).json({ verified: true })
}
