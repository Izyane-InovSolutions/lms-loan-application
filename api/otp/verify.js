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

  const draft = await kv.get(`draft:${email}`)
  if (!draft) {
    // TEMPORARY diagnostic — remove once the resume misses are explained. The draft
    // writes return 200 while this read returns nothing, so the open question is only
    // whether both sides agree on the key. Printing the key looked up alongside the
    // keys that actually exist answers that in a single request.
    try {
      // SCAN applies COUNT before MATCH, so one pass only inspects the first slice of
      // the keyspace — with draftToken:* and otp:* sharing the store that silently
      // truncated the list and made it look like drafts were missing that were not.
      // Iterate to cursor 0 so the output is actually the full set.
      const keys = []
      let cursor = 0
      do {
        const [next, batch] = await kv.scan(cursor, { match: 'draft:*', count: 500 })
        cursor = Number(next)
        keys.push(...batch)
      } while (cursor !== 0 && keys.length < 500)
      console.warn('[resume] draft miss', { lookedUp: `draft:${email}`, existing: keys.sort() })
    } catch (error) {
      console.warn('[resume] draft miss; scan failed', { lookedUp: `draft:${email}`, error: error?.message })
    }
    return res.status(404).json({ message: 'No in-progress application found for this email.' })
  }

  // Consumed only now that the resume is certain to succeed. Burning the code before
  // the draft lookup meant a miss returned "no in-progress application found", and the
  // retry of that same still-valid code then reported "that code has expired" — two
  // different errors for one problem, with a fresh code needed after every attempt.
  await kv.del(otpKey)

  const token = generateToken()
  await kv.set(`draftToken:${token}`, email, { ex: DRAFT_TTL_SECONDS })

  return res.status(200).json({ draftToken: token, draft })
}
