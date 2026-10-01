import crypto from 'node:crypto'
import { isDeployed } from './runtime.js'

/*
 * Encryption for credentials administrators enter in Settings (LMS password or API
 * secret, SMS key), so a database dump alone does not expose them. AES-256-GCM with a
 * key from LOS_SECRETS_KEY, which lives only in the environment.
 *
 *   LOS_SECRETS_KEY   any long random string (e.g. `openssl rand -base64 32`). Changing it
 *                     makes stored credentials unreadable; they must then be re-entered.
 *
 * Locally, without the variable, a fixed development key is used so Settings still work.
 * On a deployment the key is required before any credential can be saved.
 */

const PREFIX = 'enc:v1:'
const DEV_KEY = 'los-development-only-key-do-not-use-in-production'

const keyMaterial = () => {
  const configured = (process.env.LOS_SECRETS_KEY || '').trim()
  if (configured) return configured
  if (isDeployed()) {
    throw new Error('Set LOS_SECRETS_KEY in the environment before saving credentials in Settings.')
  }
  return DEV_KEY
}

const key = () => crypto.createHash('sha256').update(keyMaterial()).digest()

export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX)

export const encryptSecret = (plain) => {
  if (plain === null || plain === undefined || plain === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`
}

/** The plain value, or null if it is missing or cannot be decrypted (wrong key). */
export const decryptSecret = (stored) => {
  if (!isEncrypted(stored)) return null
  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * A key for HMAC seals (signature records), derived from LOS_SECRETS_KEY so it never sits
 * in the database next to what it protects. Null on a deployment without the variable: records
 * are then left unsealed rather than refusing to sign.
 */
export const sealKey = (purpose) => {
  const configured = (process.env.LOS_SECRETS_KEY || '').trim()
  if (!configured && isDeployed()) return null
  return crypto.createHmac('sha256', configured || DEV_KEY).update(`los-seal:${purpose}`).digest()
}
