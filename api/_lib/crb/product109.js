import soap from 'soap'
import fs from 'node:fs'
import axios from 'axios'
import tls from 'node:tls'
import https from 'node:https'
import { buildStoredReport } from './normalize.js'


const OPERATION = 'getProduct109'
const DEFAULT_TIMEOUT_SECONDS = 30
const WSDL_ATTEMPTS = 3

// Each required setting: its environment variable, and its name in Settings → Credit bureau.
const REQUIRED = {
  wsdlUrl: { env: 'CRB_WSDL_URL', label: 'WSDL address' },
  transportUsername: { env: 'CRB_TRANSPORT_USERNAME', label: 'transport username' },
  transportPassword: { env: 'CRB_TRANSPORT_PASSWORD', label: 'transport password' },
  messageUsername: { env: 'CRB_MESSAGE_USERNAME', label: 'message username' },
  messagePassword: { env: 'CRB_MESSAGE_PASSWORD', label: 'message password' },
  code: { env: 'CRB_CODE', label: 'subscriber code' },
  infinityCode: { env: 'CRB_INFINITY_CODE', label: 'infinity code' },
}

export class CrbError extends Error {
  /**
   * @param code       stable reason for callers and tests (crb_timeout, crb_auth_failed, …)
   * @param uncertain  no answer came back, so the bureau may still have recorded the enquiry
   */
  constructor(message, { code = 'crb_failed', uncertain = false, cause } = {}) {
    super(message, { cause })
    this.name = 'CrbError'
    this.code = code
    this.uncertain = uncertain
  }
}

const env = (name) => (process.env[name] || '').trim()

/** The connection from the CRB_* environment variables (Settings → Credit bureau set to "environment"). */
export const readConfig = () => ({
  wsdlUrl: env('CRB_WSDL_URL'),
  transportUsername: env('CRB_TRANSPORT_USERNAME'),
  // Passwords are taken as-is: leading or trailing spaces may be part of them.
  transportPassword: process.env.CRB_TRANSPORT_PASSWORD || '',
  messageUsername: env('CRB_MESSAGE_USERNAME'),
  messagePassword: process.env.CRB_MESSAGE_PASSWORD || '',
  code: env('CRB_CODE'),
  infinityCode: env('CRB_INFINITY_CODE'),
  // The existing adapter sends 2 for both; the codes are defined by the bureau contract.
  reportReason: Number(env('CRB_REPORT_REASON') || 2),
  reportSector: Number(env('CRB_REPORT_SECTOR') || 2),
  timeoutMs: Math.max(5, Number(env('CRB_TIMEOUT_SECONDS')) || DEFAULT_TIMEOUT_SECONDS) * 1000,
  caFile: env('CRB_CA_FILE'),
  testIdentity: env('CRB_TEST_IDENTITY'),
  source: 'environment',
})

/**
 * What a config still lacks — for System health and Settings, never the values. Named by
 * environment variable when that is where it comes from, else as Settings labels it.
 */
export const missingConfig = (config = readConfig()) =>
  Object.entries(REQUIRED)
    .filter(([key]) => !config[key])
    .map(([, field]) => (config.source === 'environment' ? field.env : field.label))

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Credentials travel on every request, so every request goes over HTTPS — the WSDL,
 * schema imports and the service endpoint the WSDL names. Plain HTTP is accepted only
 * to this machine, for a local stand-in in tests.
 */
const createHttp = (config) => {
  const ca = config.caFile ? [...tls.rootCertificates, fs.readFileSync(config.caFile, 'utf8')] : undefined
  const instance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true, ...(ca ? { ca } : {}) }),
    timeout: config.timeoutMs,
    // A redirect could carry the Basic credentials somewhere unexpected.
    maxRedirects: 0,
    proxy: false,
  })
  instance.interceptors.request.use((request) => {
    const url = new URL(request.url)
    if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
      throw new CrbError('The credit bureau address must use HTTPS.', { code: 'crb_insecure_url' })
    }
    return request
  })
  instance.interceptors.response.use((response) => {
    // node-soap reads any status as a SOAP body; a refused login has none, so say so plainly.
    if (response.status === 401 || response.status === 403) {
      throw new CrbError('The credit bureau refused our credentials.', { code: 'crb_auth_failed' })
    }
    return response
  })
  return instance
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'])
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'])

const findCrbError = (error) => {
  for (let current = error; current; current = current.cause) if (current instanceof CrbError) return current
  return null
}

/**
 * One CrbError per way a call can fail. Messages are for staff and never repeat what the
 * bureau sent back: a fault can echo the request, which holds the applicant's NRC.
 */

const classify = (error, { sent }) => {
  const known = findCrbError(error)
  if (known) return known
  const code = error?.code || error?.cause?.code
  if (TLS_CODES.has(code)) return new CrbError('The credit bureau’s certificate could not be verified.', { code: 'crb_tls_failed', cause: error })
  if (TIMEOUT_CODES.has(code) || /timeout/i.test(error?.message || '')) {
    return new CrbError('The credit bureau did not answer in time.', { code: 'crb_timeout', uncertain: sent, cause: error })
  }
  if (UNREACHABLE_CODES.has(code)) return new CrbError('The credit bureau could not be reached.', { code: 'crb_unreachable', cause: error })
  if (error?.root?.Envelope?.Body?.Fault) return new CrbError('The credit bureau rejected the request.', { code: 'crb_fault', cause: error })
  if (error?.response?.status >= 500) return new CrbError('The credit bureau reported an error.', { code: 'crb_server_error', cause: error })
  if (sent) return new CrbError('The credit bureau sent an answer we could not read.', { code: 'crb_malformed_response', uncertain: true, cause: error })
  return new CrbError('The credit bureau’s service description could not be loaded.', { code: 'crb_wsdl_failed', cause: error })
}

/** The operation's input elements, in the order the WSDL's schema defines them. */


const inputOrder = (client) => {
  for (const service of Object.values(client.describe())) {
    for (const port of Object.values(service)) {
      if (port[OPERATION]) return Object.keys(port[OPERATION].input || {})
    }
  }
  return null
}

/**
 * Builds the request in WSDL order. Every argument the existing adapter sends must exist
 * in the WSDL: if one does not, this is a different service and nothing is sent.
 */

export const buildArguments = (client, config, identity) => {
  const values = {
    username: config.messageUsername,
    password: config.messagePassword,
    code: config.code,
    infinityCode: config.infinityCode,
    nationalID: identity.nrc,
    name1: identity.otherNames,
    name2: identity.surname,
    reportReason: config.reportReason,
    reportSector: config.reportSector,
  }
  const order = inputOrder(client)
  if (!order) throw new CrbError(`The bureau's WSDL has no ${OPERATION} operation.`, { code: 'crb_contract_mismatch' })
  const unknown = Object.keys(values).filter((name) => !order.includes(name))
  if (unknown.length) throw new CrbError(`The bureau's WSDL does not accept: ${unknown.join(', ')}.`, { code: 'crb_contract_mismatch' })
  return Object.fromEntries(order.filter((name) => name in values).map((name) => [name, values[name]]))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Loading the WSDL is a read, so it is retried on network trouble. Kept per warm
 * instance; a failed load is forgotten so the next check tries again.
 */
let cached = null

const loadClient = (config, { fresh = false } = {}) => {
  const key = `${config.wsdlUrl}|${config.transportUsername}|${config.caFile}|${config.timeoutMs}`
  if (!fresh && cached?.key === key) return cached.promise
  const http = createHttp(config)
  const security = new soap.BasicAuthSecurity(config.transportUsername, config.transportPassword)
  const promise = (async () => {
    let lastError
    for (let attempt = 1; attempt <= WSDL_ATTEMPTS; attempt += 1) {
      try {
        const client = await soap.createClientAsync(config.wsdlUrl, {
          request: http,
          // node-soap keeps parsed WSDLs by address; a test must fetch it with its own credentials.
          ...(fresh ? { disableCache: true } : {}),
          wsdl_headers: (() => {
            const headers = {}
            security.addHeaders(headers)
            return headers
          })(),
        })
        client.setSecurity(security)
        return client
      } catch (error) {
        lastError = classify(error, { sent: false })
        const transient = ['crb_timeout', 'crb_unreachable', 'crb_server_error'].includes(lastError.code)
        if (!transient || attempt === WSDL_ATTEMPTS) break
        await wait(500 * attempt)
      }
    }
    throw lastError
  })()
  // A connection test loads its own copy, so a wrong password can't hide behind a cached client.
  if (fresh) return promise
  cached = { key, promise }
  promise.catch(() => {
    if (cached?.promise === promise) cached = null
  })
  return promise
}

/**
 * UAT only: a test identity "NRC|other names|surname" (CRB_TEST_IDENTITY, or the test
 * identity in Settings → Credit bureau) sends the bureau's test person
 * instead of the applicant, since a test account only knows its own test identities.
 * Every report pulled this way is marked as the test person's, and the setting is
 * refused in production, where it would attach one person's record to every applicant.
 */
export const testIdentity = (config = readConfig()) => {
  const value = (config.testIdentity || '').trim()
  if (!value) return null
  const name = config.source === 'environment' ? 'CRB_TEST_IDENTITY' : 'The bureau test identity'
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new CrbError(`${name} is set on a production deployment. Remove it.`, { code: 'crb_not_configured' })
  }
  const [nrc, otherNames, surname] = value.split('|').map((part) => part.trim())
  if (!nrc || !otherNames || !surname) {
    throw new CrbError(`${name} must be "NRC|other names|surname".`, { code: 'crb_not_configured' })
  }
  return { nrc, otherNames, surname }
}

/** JAX-WS style services wrap the answer in `return`; others give it directly. */
const unwrap = (result) => (result && typeof result === 'object' && 'return' in result ? result.return : result)

/** The Product 109 provider over one resolved config (readConfig(), or Settings → Credit bureau). */
export const createProduct109Provider = (config = readConfig()) => ({
  name: 'product109',
  label: 'Credit bureau (Product 109)',
  sample: false,
  config,

  /**
   * One Product 109 enquiry. Not retried: every call is an enquiry the bureau records
   * (and bills), and a timeout does not tell us whether it was recorded.
   *
   * @param identity  from identityFor(): { nrc, otherNames, surname }
   * @returns { score, report } as crb_reports stores them
   */
  async fetchReport(identity) {
    const missing = missingConfig(config)
    if (missing.length) throw new CrbError(`The credit bureau is not fully set up (missing ${missing.join(', ')}).`, { code: 'crb_not_configured' })
    const test = testIdentity(config)
    const sent = test || identity
    const client = await loadClient(config)
    const args = buildArguments(client, config, sent)

    let result
    try {
      ;[result] = await client[`${OPERATION}Async`](args, { timeout: config.timeoutMs })
    } catch (error) {
      throw classify(error, { sent: true })
    }
    const body = unwrap(result)
    if (!body || typeof body !== 'object') {
      throw new CrbError('The credit bureau sent an empty answer.', { code: 'crb_malformed_response', uncertain: true })
    }
    const stored = buildStoredReport(body, sent)
    // Recorded on the report itself, so it can never pass for the applicant's own.
    if (test) stored.report.testIdentity = { nrc: test.nrc, applicantNrc: identity.nrc }
    return stored
  },

  /**
   * Proves the connection without an enquiry (each one is recorded and billed): loads
   * the WSDL with the transport credentials and checks it offers Product 109 with the
   * arguments we send. The message credentials are only checked by a real enquiry.
   */
  async testConnection() {
    const missing = missingConfig(config)
    if (missing.length) throw new CrbError(`The credit bureau is not fully set up (missing ${missing.join(', ')}).`, { code: 'crb_not_configured' })
    testIdentity(config)
    const startedAt = Date.now()
    const client = await loadClient(config, { fresh: true })
    buildArguments(client, config, { nrc: '000000/00/0', otherNames: 'Test', surname: 'Test' })
    return { milliseconds: Date.now() - startedAt }
  },
})

/** For tests: drop the cached client so a changed WSDL or stand-in is picked up. */
export const resetProduct109Client = () => {
  cached = null
}
