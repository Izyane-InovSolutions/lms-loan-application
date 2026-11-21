import kv from '../_lib/kv.js'
import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { normalizeEmail, generateToken } from '../_lib/token.js'

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

  const otpError = await checkOtp({ email, code, purpose: 'resume', req })
  if (otpError) {
    return res.status(otpError.status).json({ message: otpError.message })
  }

  const draft = await kv.get(`draft:${email}`)
  if (!draft) {
    return res.status(404).json({ message: 'No in-progress application found for this email.' })
  }

  // Consumed only now that the resume is certain to succeed. Burning the code before
  // the draft lookup meant a miss returned "no in-progress application found", and the
  // retry of that same still-valid code then reported "that code has expired" — two
  // different errors for one problem, with a fresh code needed after every attempt.
  await consumeOtp('resume', email)

  // The code proved the email: a draft started before codes were asked for counts as confirmed by it.
  if (!draft.verified && draft.id) {
    draft.verified = { channel: 'email', value: email, at: Date.now() }
    const keys = [...new Set([...(draft.aliases || []), email])]
    await Promise.all(keys.map((key) => kv.set(`draft:${key}`, draft, { ex: DRAFT_TTL_SECONDS })))
  }

  const token = generateToken()
  await kv.set(`draftToken:${token}`, email, { ex: DRAFT_TTL_SECONDS })

  return res.status(200).json({ draftToken: token, draft })
}
