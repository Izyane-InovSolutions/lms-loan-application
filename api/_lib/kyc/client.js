import { isDeployed } from '../runtime.js'
import { KYC_ID_TYPES, applyMapping, readPath } from '../../../src/config/kyc.js'

/*
 * Looks a customer up on the institution's own platform (Settings → Customer records),
 * as the admin described it: connection and sign-in, one request per ID type, what a
 * found answer looks like, where the record is, and how it maps to the form
 * (src/config/kyc.js). Any HTTP/JSON platform; nothing here knows a particular one.
 *
 * Never throws for the platform's sake: the answer is { status: 'found' | 'not_found' |
 * 'error', … }. Errors carry our own wording and the HTTP status, never the body, which
 * may hold someone's personal details.
 */

const MAX_BODY_BYTES = 512 * 1024
const tokenCache = new Map()

export class KycConfigError extends Error {}

const isLocalHost = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)

/** The request URL for `path` on the base URL, refusing plain HTTP to another machine on a deployment. */
export const requestUrl = (config, path, id) => {
  if (!config.baseUrl) throw new KycConfigError('No base URL is set.')
  let base
  try {
    base = new URL(config.baseUrl)
  } catch {
    throw new KycConfigError('The base URL isn’t a valid address.')
  }
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && (!isDeployed() || isLocalHost(base.hostname)))) {
    throw new KycConfigError('The base URL must start with https://.')
  }
  const filled = String(path || '').replaceAll('{id}', encodeURIComponent(id))
  return new URL(filled.replace(/^\//, ''), base.href.endsWith('/') ? base.href : `${base.href}/`).toString()
}

const oauthToken = async (config, timeoutMs) => {
  const key = `${config.tokenUrl}|${config.clientId}|${config.scope}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.token
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret })
  if (config.scope) body.set('scope', config.scope)
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(timeoutMs) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) throw new Error(`The token service answered ${response.status}.`)
  tokenCache.set(key, { token: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 300) * 1000 })
  return payload.access_token
}

/** The headers the platform's sign-in needs, and the admin's extra ones. */
export const authHeaders = async (config, timeoutMs) => {
  const headers = { Accept: 'application/json' }
  for (const header of config.headers || []) if (header?.name) headers[header.name] = String(header.value ?? '')
  if (config.authType === 'apiKey') headers[config.apiKeyHeader || 'X-API-Key'] = config.apiKey
  if (config.authType === 'bearer') headers.Authorization = `Bearer ${config.bearerToken}`
  if (config.authType === 'basic') headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
  if (config.authType === 'oauth') headers.Authorization = `Bearer ${await oauthToken(config, timeoutMs)}`
  return headers
}

/** Whether a parsed answer counts as found, by the admin's check (a path and the value there). */
const isFound = (config, json) => {
  if (!config.foundPath) return true
  const value = readPath(json, config.foundPath)
  return String(value).toLowerCase() === String(config.foundValue ?? '').toLowerCase()
}

/**
 * Looks up `id` of `idType` (nrc, passport, tpin). Returns { status, httpStatus, ms,
 * raw?, record?, values?, contacts? }: `raw` (the parsed answer) is for Test lookup only.
 */
export const kycLookup = async (config, idType, id) => {
  const started = Date.now()
  const done = (result) => ({ ms: Date.now() - started, httpStatus: null, ...result })
  const lookup = config.lookups?.[idType]
  if (!KYC_ID_TYPES[idType] || !lookup?.enabled || !lookup.path) return done({ status: 'error', error: `Lookups by ${KYC_ID_TYPES[idType]?.label || idType} aren’t set up.` })
  const timeoutMs = Math.min(Math.max(Number(config.timeoutSeconds) || 10, 1), 60) * 1000

  let response
  try {
    const url = requestUrl(config, lookup.path, id)
    const headers = await authHeaders(config, timeoutMs)
    const post = lookup.method === 'POST'
    if (post) headers['Content-Type'] = 'application/json'
    response = await fetch(url, {
      method: post ? 'POST' : 'GET',
      headers,
      body: post ? String(lookup.body || '').replaceAll('{id}', JSON.stringify(String(id)).slice(1, -1)) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
  } catch (error) {
    if (error instanceof KycConfigError) return done({ status: 'error', error: error.message })
    return done({ status: 'error', error: error.name === 'TimeoutError' ? 'The platform didn’t answer in time.' : `The platform couldn’t be reached${error.message?.startsWith('The token') ? ` (${error.message})` : ''}.` })
  }

  if (response.status === 404) return done({ status: 'not_found', httpStatus: 404 })
  const text = await response.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return done({ status: 'error', httpStatus: response.status, error: 'The platform’s answer was too large.' })
  if (!response.ok) return done({ status: 'error', httpStatus: response.status, error: `The platform answered ${response.status}.` })
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return done({ status: 'error', httpStatus: response.status, error: 'The platform’s answer wasn’t JSON.' })
  }
  if (!isFound(config, json)) return done({ status: 'not_found', httpStatus: response.status, raw: json })
  const record = readPath(json, config.recordPath)
  if (!record || typeof record !== 'object') return done({ status: 'not_found', httpStatus: response.status, raw: json })
  const { values, contacts } = applyMapping(record, config.mappings?.[KYC_ID_TYPES[idType].form] || [], KYC_ID_TYPES[idType].form)
  return done({ status: 'found', httpStatus: response.status, raw: json, record, values, contacts })
}

/** The answer for an admin to read: values under keys that look secret, or personal photos, hidden. */
export const redactRaw = (value, depth = 0) => {
  if (depth > 8) return '…'
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactRaw(entry, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, /secret|token|password|api[_-]?key|signature/i.test(key) ? '[hidden]' : redactRaw(entry, depth + 1)])
  )
}

export const clearKycTokenCache = () => tokenCache.clear()
