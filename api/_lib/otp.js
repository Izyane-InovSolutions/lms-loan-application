import kv from './kv.js'

const MAX_ATTEMPTS = 5

/**
 * Checks an emailed code without consuming it. Returns null when it matches, or the
 * { status, message } to send back. A wrong guess counts towards the attempt limit.
 *
 * Consuming is left to the caller (consumeOtp) because some flows only burn the code
 * once the rest of the request is certain to succeed — see otp/verify.js.
 */
export const checkOtp = async (email, code) => {
  const otpKey = `otp:${email}`
  const record = await kv.get(otpKey)
  if (!record) {
    return { status: 400, message: 'That code has expired. Please request a new one.' }
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await kv.del(otpKey)
    return { status: 429, message: 'Too many incorrect attempts. Please request a new code.' }
  }

  if (record.code !== code) {
    await kv.set(otpKey, { ...record, attempts: record.attempts + 1 }, { keepTtl: true })
    return { status: 400, message: 'The code entered is incorrect.' }
  }

  return null
}

export const consumeOtp = (email) => kv.del(`otp:${email}`)
