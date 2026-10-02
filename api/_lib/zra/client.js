import crypto from 'node:crypto'
import kv from '../kv.js'
import { decryptSecret, encryptSecret } from '../secrets.js'
import { zraTokenStore } from './tokenStore.js'

const LOOKUP_TYPES = new Set(['TPIN', 'NRC', 'PASSPORT', 'BRN'])
const REQUEST_TIMEOUT_MS = 15000
const TOKEN_REFRESH_MARGIN_MS = 60000
const REQUEST_GATE_SECONDS = 2
const TOKEN_LOCK_SECONDS = 60
const TOKEN_REFRESH_WAIT_MS = 30000

export class ZraError extends Error {
  constructor(message, code = 'zra_failed') {
    super(message)
    this.name = 'ZraError'
    this.code = code
  }
}

const env = (name) => (process.env[name] || '').trim()

const localHttpUatEnabled = () =>
  process.env.ZRA_ALLOW_HTTP_UAT === 'true'
  && process.env.ZRA_UAT_MODE === 'true'
  && process.env.ZRA_UAT_SMOKE_ENABLED === 'true'
  && ['development', 'test'].includes(process.env.NODE_ENV)
  && process.env.VERCEL_ENV !== 'production'
  && !process.env.VERCEL

export const readZraConfig = () => ({
  baseUrl: env('ZRA_BASE_URL'),
  apiKey: process.env.ZRA_API_KEY || '',
  username: env('ZRA_USERNAME'),
  password: process.env.ZRA_PASSWORD || '',
  timeoutSeconds: Number(process.env.ZRA_REQUEST_TIMEOUT_SECONDS) || 10,
})

export const missingZraConfig = (config = readZraConfig()) =>
  Object.entries({
    ZRA_BASE_URL: config.baseUrl,
    ZRA_API_KEY: config.apiKey,
    ZRA_USERNAME: config.username,
    ZRA_PASSWORD: config.password,
  }).filter(([, value]) => !value).map(([name]) => name)

const checkedBaseUrl = (value) => {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ZraError('ZRA_BASE_URL must be a valid HTTPS origin.', 'zra_not_configured')
  }
  const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && localHttpUatEnabled())
  if (!allowedProtocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ZraError('ZRA_BASE_URL must be HTTPS; HTTP is allowed only with explicit local UAT enabled.', 'zra_not_configured')
  }
  return url.origin
}

const checkedEndpoint = (value, baseUrl) => {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new ZraError('ZRA request paths must be relative to the configured ZRA origin.', 'zra_invalid_endpoint')
  }
  const url = new URL(value, `${baseUrl}/`)
  if (url.origin !== baseUrl || !url.pathname.startsWith('/zws/')) {
    throw new ZraError('ZRA request paths must target a ZWS resource on the configured origin.', 'zra_invalid_endpoint')
  }
  return url
}

const tokenValue = (value, label) => {
  if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) {
    throw new ZraError(`ZRA returned an invalid ${label}.`, 'zra_malformed_response')
  }
  return value
}

const tokenResponse = (body, now) => {
  if (body?.header?.status !== 'SUCCESS' || !body.data || typeof body.data !== 'object') {
    throw new ZraError('ZRA authentication was rejected.', 'zra_auth_failed')
  }
  const { accessToken, refreshToken, tokenType, expiresIn, refreshExpiresIn } = body.data
  if (String(tokenType || '').toLowerCase() !== 'bearer') {
    throw new ZraError('ZRA returned an unsupported token type.', 'zra_malformed_response')
  }
  const accessSeconds = Number(expiresIn)
  const refreshSeconds = Number(refreshExpiresIn)
  if (!Number.isFinite(accessSeconds) || accessSeconds <= 0 || !Number.isFinite(refreshSeconds) || refreshSeconds <= 0) {
    throw new ZraError('ZRA returned invalid token expiry details.', 'zra_malformed_response')
  }
  return {
    accessToken: tokenValue(accessToken, 'access token'),
    refreshToken: tokenValue(refreshToken, 'refresh token'),
    accessExpiresAt: now + accessSeconds * 1000,
    refreshExpiresAt: now + refreshSeconds * 1000,
  }
}

const isNotFound = (body) => String(body?.header?.errorCode || '') === '5000'

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export const createZraRequestGate = ({ kvStore = kv, sleep = pause, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => async () => {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    try {
      if (await kvStore.set('los:zra:request-gate', crypto.randomUUID(), { nx: true, ex: REQUEST_GATE_SECONDS }) !== null) return
    } catch {
      throw new ZraError('ZRA request pacing is unavailable; the request was not sent.', 'zra_rate_gate_failed')
    }
    await sleep(100)
  }
  throw new ZraError('ZRA request pacing timed out; retry shortly.', 'zra_rate_limited')
}

export const createZraClient = ({
  config = readZraConfig(),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  kvStore = kv,
  tokenStore = zraTokenStore,
  encrypt = encryptSecret,
  decrypt = decryptSecret,
  requestGate,
} = {}) => {
  const missing = missingZraConfig(config)
  if (missing.length) throw new ZraError(`ZRA is not configured (missing ${missing.join(', ')}).`, 'zra_not_configured')
  if (typeof fetchImpl !== 'function') throw new ZraError('This Node.js runtime does not provide fetch.', 'zra_not_configured')

  const baseUrl = checkedBaseUrl(config.baseUrl)
  const requestTimeoutMs = Number.isFinite(Number(config.timeoutSeconds)) && Number(config.timeoutSeconds) > 0
    ? Number(config.timeoutSeconds) * 1000
    : REQUEST_TIMEOUT_MS
  const acquireRequestSlot = requestGate || createZraRequestGate({ kvStore, timeoutMs: requestTimeoutMs })
  const tokenScope = JSON.stringify([baseUrl, config.apiKey, config.username])
  const tokenKey = `los:zra:tokens:${crypto.createHash('sha256').update(tokenScope).digest('hex').slice(0, 24)}`
  const tokenLockKey = `${tokenKey}:lock`
  let tokens = null
  let tokenPromise = null

  const requestJson = async (path, { body, accessToken, method = 'POST' } = {}) => {
    const url = checkedEndpoint(path, baseUrl)
    await acquireRequestSlot()
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': config.apiKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ZraError('ZRA did not respond before the request timed out.', 'zra_timeout')
      }
      throw new ZraError('ZRA could not be reached. Check the server network and VPN access.', 'zra_unreachable')
    }

    if (response.status === 404 && path.endsWith('/taxpayer-lookup')) return { notFound: true }
    if (response.status === 401) throw new ZraError('ZRA rejected the access token.', 'zra_unauthorized')
    if (response.status === 403) throw new ZraError('ZRA rejected the credentials or access token.', 'zra_auth_failed')
    if (response.status === 429) throw new ZraError('ZRA rate limit reached. Wait before trying again.', 'zra_rate_limited')
    if (!response.ok) throw new ZraError('ZRA returned an unsuccessful response.', 'zra_upstream_error')

    try {
      return await response.json()
    } catch {
      throw new ZraError('ZRA returned a response that was not valid JSON.', 'zra_malformed_response')
    }
  }

  const login = async () => {
    const body = await requestJson('/zws/auth/login', {
      body: { username: config.username, password: config.password },
    })
    tokens = tokenResponse(body, now())
    return tokens
  }

  const refresh = async () => {
    const body = await requestJson('/zws/auth/refresh-token', {
      body: { refreshToken: tokens.refreshToken },
    })
    tokens = tokenResponse(body, now())
    return tokens
  }

  const readStoredTokens = async () => {
    let raw
    try {
      raw = await tokenStore.get(tokenKey)
    } catch {
      throw new ZraError('The shared ZRA token store is unavailable.', 'zra_token_store_failed')
    }
    if (!raw) return null
    let stored
    try {
      stored = JSON.parse(decrypt(raw) || 'null')
    } catch {
      return null
    }
    if (!stored || typeof stored.accessToken !== 'string' || typeof stored.refreshToken !== 'string'
      || !Number.isFinite(stored.accessExpiresAt) || !Number.isFinite(stored.refreshExpiresAt)) return null
    return stored
  }

  const storeTokens = async (value) => {
    try {
      const encrypted = encrypt(JSON.stringify(value))
      if (!encrypted) throw new Error('Encryption returned no value.')
      await tokenStore.set(tokenKey, encrypted)
    } catch {
      throw new ZraError('ZRA tokens could not be stored securely.', 'zra_token_store_failed')
    }
  }

  const renewTokens = async ({ forceLogin = false } = {}) => {
    const deadline = now() + TOKEN_REFRESH_WAIT_MS
    while (now() < deadline) {
      const owner = crypto.randomUUID()
      let acquired
      try {
        acquired = await kvStore.set(tokenLockKey, owner, { nx: true, ex: TOKEN_LOCK_SECONDS })
      } catch {
        throw new ZraError('The shared ZRA token lock is unavailable.', 'zra_token_store_failed')
      }
      if (acquired !== null) {
        try {
          const latest = await readStoredTokens()
          if (!forceLogin && latest && latest.accessExpiresAt > now() + TOKEN_REFRESH_MARGIN_MS) {
            tokens = latest
            return tokens
          }
          if (!forceLogin && latest && latest.refreshExpiresAt > now() + TOKEN_REFRESH_MARGIN_MS) {
            tokens = latest
            await refresh()
          } else {
            await login()
          }
          await storeTokens(tokens)
          return tokens
        } finally {
          try {
            if (await kvStore.get(tokenLockKey) === owner) await kvStore.del(tokenLockKey)
          } catch {
            // The lock expires automatically if the shared store is temporarily unavailable.
          }
        }
      }
      await pause(100)
    }
    throw new ZraError('Another request is refreshing ZRA credentials; retry shortly.', 'zra_auth_busy')
  }

  const accessToken = async ({ forceLogin = false } = {}) => {
    if (!env('LOS_SECRETS_KEY')) {
      throw new ZraError('Set LOS_SECRETS_KEY to encrypt ZRA tokens before running a lookup.', 'zra_not_configured')
    }
    if (!forceLogin && tokens && tokens.accessExpiresAt > now() + TOKEN_REFRESH_MARGIN_MS) {
      return tokens.accessToken
    }
    if (tokenPromise) return tokenPromise.then((value) => value.accessToken)
    tokenPromise = renewTokens({ forceLogin })
    try {
      return (await tokenPromise).accessToken
    } finally {
      tokenPromise = null
    }
  }

  const authenticatedRequest = async (endpoint, { body, method = 'GET' } = {}) => {
    try {
      return await requestJson(endpoint, { body, method, accessToken: await accessToken() })
    } catch (error) {
      if (!(error instanceof ZraError) || error.code !== 'zra_unauthorized') throw error
      return requestJson(endpoint, { body, method, accessToken: await accessToken({ forceLogin: true }) })
    }
  }

  return {
    async authenticate({ force = false } = {}) {
      await accessToken({ forceLogin: force })
      return { authenticated: true }
    },
    async refreshAccessToken() {
      await accessToken({ forceLogin: true })
      return { authenticated: true }
    },
    async makeRequest(endpoint, { method = 'GET', data } = {}) {
      checkedEndpoint(endpoint, baseUrl)
      const body = await authenticatedRequest(endpoint, { method, body: data })
      if (body?.header?.status && body.header.status !== 'SUCCESS') {
        throw new ZraError('ZRA returned an unsuccessful response.', 'zra_request_failed')
      }
      return body?.data ?? null
    },
    async lookup(lookupType, lookupValue) {
      if (!LOOKUP_TYPES.has(lookupType)) throw new ZraError('Choose TPIN, NRC, PASSPORT, or BRN for the lookup type.', 'zra_invalid_lookup')
      if (typeof lookupValue !== 'string' || !lookupValue.trim() || lookupValue.trim().length > 100) {
        throw new ZraError('Enter a lookup value of no more than 100 characters.', 'zra_invalid_lookup')
      }

      const body = await authenticatedRequest('/zws/v1/taxpayer-lookup', {
        method: 'POST',
        body: { lookupType, lookupValue: lookupValue.trim() },
      })
      if (body?.notFound || isNotFound(body)) {
        return { found: false }
      }
      if (body?.header?.status !== 'SUCCESS' || !body.data || typeof body.data !== 'object') {
        throw new ZraError('ZRA did not return a successful taxpayer lookup.', 'zra_lookup_failed')
      }

      const { tpin, name, idType, idNumber, brn } = body.data
      if (typeof tpin !== 'string' || !tpin.trim() || typeof name !== 'string' || !name.trim()) {
        throw new ZraError('ZRA returned an incomplete taxpayer record.', 'zra_malformed_response')
      }
      const result = {
        found: true,
        taxpayer: {
          tpin: tpin.trim(),
          name: name.trim(),
          idType: typeof idType === 'string' ? idType : null,
          idNumber: typeof idNumber === 'string' ? idNumber : null,
          brn: typeof brn === 'string' ? brn : null,
        },
      }
      return result
    },
  }
}