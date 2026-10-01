import crypto from 'node:crypto'
import kv from './kv.js'
import { countAttempt, ipOf, rateKey } from './rateLimit.js'

/*
 * Emailed one-time codes. Each code is issued for one purpose and only that purpose's
 * check accepts it: a code a customer reads out to an agent to consent to an assisted
 * application must not also sign that agent in as the customer, or resume their draft.
 *
 *   resume   continue an in-progress application (otp/verify.js)
 *   login    sign in to "My applications" (auth.js)
 *   consent  agree to an agent submitting an application with you (applications.js)
 *   offer    accept an offer in person with staff (workflow.js)
 *   sign     sign and accept an offer yourself (workflow.js)
 */
export const OTP_PURPOSES = ['resume', 'login', 'consent', 'offer', 'sign']
export const OTP_TTL_SECONDS = 600

const MAX_ATTEMPTS = 5
// Across every code for an address, so requesting a fresh code doesn't reset the budget.
const MAX_DAILY_FAILURES = 20
// Per caller, across addresses, so one client can't spread guesses over many emails.
const MAX_IP_FAILURES_PER_HOUR = 50
const DAY_SECONDS = 24 * 60 * 60

export const otpKey = (purpose, email) => `otp:${purpose}:${email}`
// Per code, by its own id: two codes issued in the same millisecond must not share a count.
const attemptsKey = (purpose, email, record) => `otp-attempts:${purpose}:${email}:${record.id || record.createdAt}`
const dailyFailuresKey = (email) => rateKey('otp-fail-email', email)
const ipFailuresKey = (req) => rateKey('otp-fail-ip', ipOf(req))

const sameCode = (a, b) => {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

const tooMany = { status: 429, message: 'Too many incorrect attempts. Please request a new code later.' }

/** True once this address or caller has used up its guesses for now. */
export const otpLocked = async (email, req) => {
  const [daily, perIp] = await Promise.all([kv.get(dailyFailuresKey(email)), req ? kv.get(ipFailuresKey(req)) : null])
  return Number(daily || 0) >= MAX_DAILY_FAILURES || Number(perIp || 0) >= MAX_IP_FAILURES_PER_HOUR
}

/** Stores a new code for `purpose`, replacing any earlier one for it. */
export const storeOtp = (purpose, email, code) => kv.set(otpKey(purpose, email), { id: crypto.randomUUID(), code, createdAt: Date.now() }, { ex: OTP_TTL_SECONDS })

/**
 * Checks an emailed code without consuming it. Returns null when it matches, or the
 * { status, message } to send back.
 *
 * Every check counts towards the code's attempt limit before the comparison, with an
 * atomic increment, so parallel guesses can't all slip in under it.
 *
 * Consuming is left to the caller (consumeOtp) because some flows only burn the code
 * once the rest of the request is certain to succeed — see otp/verify.js.
 */
export const checkOtp = async ({ email, code, purpose, req }) => {
  if (!OTP_PURPOSES.includes(purpose)) throw new Error(`Unknown code purpose: ${purpose}`)
  const key = otpKey(purpose, email)
  const record = await kv.get(key)
  if (!record) {
    return { status: 400, message: 'That code has expired. Please request a new one.' }
  }
  if (await otpLocked(email, req)) return tooMany

  const attempts = await countAttempt(attemptsKey(purpose, email, record), OTP_TTL_SECONDS)
  if (attempts > MAX_ATTEMPTS) {
    await kv.del(key)
    return { status: 429, message: 'Too many incorrect attempts. Please request a new code.' }
  }

  if (!sameCode(record.code, String(code || '').trim())) {
    await Promise.all([countAttempt(dailyFailuresKey(email), DAY_SECONDS), req ? countAttempt(ipFailuresKey(req), 60 * 60) : null])
    return { status: 400, message: 'The code entered is incorrect.' }
  }

  return null
}

export const consumeOtp = (purpose, email) => kv.del(otpKey(purpose, email))
