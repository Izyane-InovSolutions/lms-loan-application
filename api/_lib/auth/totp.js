import crypto from 'node:crypto'

/*
 * Time-based one-time passwords (RFC 6238), the six-digit codes authenticator apps
 * (Google Authenticator, Microsoft Authenticator, 1Password, …) show every 30 seconds.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

export const base32Encode = (buffer) => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export const base32Decode = (text) => {
  const clean = String(text).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20))

const codeAt = (secret, counter) => {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

export const totpCode = (secret, now = Date.now()) => codeAt(secret, Math.floor(now / 1000 / STEP_SECONDS))

/** True if `code` is valid now, or one step either side (clock drift). */
export const verifyTotp = (secret, code, now = Date.now()) => {
  const candidate = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(candidate)) return false
  const counter = Math.floor(now / 1000 / STEP_SECONDS)
  return [-1, 0, 1].some((drift) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, counter + drift)), Buffer.from(candidate)))
}

export const otpauthUrl = ({ secret, email, issuer = 'Loan Origination' }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`

const hashCode = (code) => crypto.createHash('sha256').update(code.replace(/-/g, '').toUpperCase()).digest('hex')

/** Ten one-time recovery codes like "7K2Q-9MXD". Returns the codes (shown once) and their hashes (stored). */
export const newRecoveryCodes = () => {
  const codes = Array.from({ length: 10 }, () => {
    const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8)
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  })
  return { codes, hashes: codes.map(hashCode) }
}

/** The remaining hashes if `code` matched one (it is used up), else null. */
export const useRecoveryCode = (hashes, code) => {
  const hashed = hashCode(String(code || ''))
  if (!Array.isArray(hashes) || !hashes.includes(hashed)) return null
  return hashes.filter((entry) => entry !== hashed)
}
