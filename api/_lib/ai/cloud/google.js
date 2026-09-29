import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

/*
 * OAuth access tokens for Google Cloud APIs (Vertex AI, Document AI) from a service
 * account key, using the JWT-bearer grant. Tokens last an hour and are cached per
 * service account until shortly before they expire.
 */

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const cache = new Map()

const base64url = (value) => Buffer.from(value).toString('base64url')

/** Parses and checks a service account key; throws a message an admin can act on. */
export const parseServiceAccount = (json) => {
  let account
  try {
    account = JSON.parse(json)
  } catch {
    throw new Error('The service account key is not valid JSON. Paste the whole file Google gave you.')
  }
  if (account?.type !== 'service_account' || !account.client_email || !account.private_key) {
    throw new Error('That JSON is not a service account key (it needs client_email and private_key).')
  }
  return account
}

export const googleAccessToken = async (json, { timeoutMs = 15000 } = {}) => {
  const account = parseServiceAccount(json)
  const cached = cache.get(account.client_email)
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token

  const now = Math.floor(Date.now() / 1000)
  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })
  )}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    throw new Error(`Google sign-in failed (${response.status}): ${body.error_description || body.error || 'no token returned'}`)
  }
  cache.set(account.client_email, { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 })
  return body.access_token
}
