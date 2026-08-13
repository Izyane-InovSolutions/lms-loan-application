import crypto from 'node:crypto'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = (email) => {
  const trimmed = String(email || '').trim().toLowerCase()
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null
}

export const generateOtpCode = () => String(Math.floor(100000 + Math.random() * 900000))

export const generateToken = () => crypto.randomBytes(24).toString('hex')
