import crypto from 'node:crypto'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = (email) => {
  const trimmed = String(email || '').trim().toLowerCase()
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null
}

// crypto.randomInt, not Math.random: the code is the only thing standing between an email
// address and its draft, so it must not be predictable.
export const generateOtpCode = () => String(crypto.randomInt(100000, 1000000))

export const generateToken = () => crypto.randomBytes(24).toString('hex')
