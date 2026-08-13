import kv from '../_lib/kv.js'
import { normalizeEmail, generateToken } from '../_lib/token.js'

const MAX_ATTEMPTS = 5
const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60

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

  const draft = await kv.get(`draft:${email}`)
  if (!draft) {
    return res.status(404).json({ message: 'No in-progress application found for this email.' })
  }

  const token = generateToken()
  await kv.set(`draftToken:${token}`, email, { ex: DRAFT_TTL_SECONDS })

  return res.status(200).json({ draftToken: token, draft })
}
