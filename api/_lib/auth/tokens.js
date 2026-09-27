import crypto from 'node:crypto'

/** A random secret for a cookie or emailed link. Only its hash is stored. */
export const newToken = () => crypto.randomBytes(32).toString('base64url')

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// No 0/O or 1/I, so a code read out over the phone survives.
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const newReferralCode = () =>
  Array.from({ length: 8 }, () => REFERRAL_ALPHABET[crypto.randomInt(REFERRAL_ALPHABET.length)]).join('')
