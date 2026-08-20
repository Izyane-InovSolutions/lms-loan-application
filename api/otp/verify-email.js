import kv from '../_lib/kv.js'
import { normalizeEmail } from '../_lib/token.js'

const MAX_ATTEMPTS = 5

// Same OTP check as ./verify.js, without the draft lookup — this just confirms the
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

  const otpKey = `otp:${email}`
  const record = await kv.get(otpKey)
  if (!record) {
    return res.status(400).json({ message: 'That code has expired. Please request a new one.' })
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await kv.del(otpKey)
    return res.status(429).json({ message: 'Too many incorrect attempts. Please request a new code.' })
  }

  if (record.code !== code) {
    await kv.set(otpKey, { ...record, attempts: record.attempts + 1 }, { keepTtl: true })
    return res.status(400).json({ message: 'The code entered is incorrect.' })
  }

  await kv.del(otpKey)
  return res.status(200).json({ verified: true })
}
