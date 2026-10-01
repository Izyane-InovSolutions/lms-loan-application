import soap from 'soap'
import fs from 'node:fs'
import axios from 'axios'
import tls from 'node:tls'
import https from 'node:https'
import { buildStoredReport } from './normalize.js'


const OPERATION = 'getProduct109'
const DEFAULT_TIMEOUT_SECONDS = 30
const WSDL_ATTEMPTS = 3

const REQUIRED = {
  CRB_WSDL_URL: 'WSDL address',
  CRB_TRANSPORT_USERNAME: 'transport username',
  CRB_TRANSPORT_PASSWORD: 'transport password',
  CRB_MESSAGE_USERNAME: 'message username',
  CRB_MESSAGE_PASSWORD: 'message password',
  CRB_CODE: 'subscriber code',
  CRB_INFINITY_CODE: 'infinity code',
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
})

/** Names of the variables still unset — for System health, never their values. */
export const missingConfig = () => Object.keys(REQUIRED).filter((name) => !(name.includes('PASSWORD') ? process.env[name] : env(name)))

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

const loadClient = (config) => {
  const key = `${config.wsdlUrl}|${config.transportUsername}|${config.caFile}|${config.timeoutMs}`
  if (cached?.key === key) return cached.promise
  const http = createHttp(config)
  const security = new soap.BasicAuthSecurity(config.transportUsername, config.transportPassword)
  const promise = (async () => {
    let lastError
    for (let attempt = 1; attempt <= WSDL_ATTEMPTS; attempt += 1) {
      try {
        const client = await soap.createClientAsync(config.wsdlUrl, {
          request: http,
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
  cached = { key, promise }
  promise.catch(() => {
    if (cached?.promise === promise) cached = null
  })
  return promise
}

/**
 * UAT only: CRB_TEST_IDENTITY="NRC|other names|surname" sends the bureau's test person
 * instead of the applicant, since a test account only knows its own test identities.
 * Every report pulled this way is marked as the test person's, and the setting is
 * refused in production, where it would attach one person's record to every applicant.
 */
export const testIdentity = () => {
  const value = env('CRB_TEST_IDENTITY')
  if (!value) return null
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new CrbError('CRB_TEST_IDENTITY is set on a production deployment. Remove it.', { code: 'crb_not_configured' })
  }
  const [nrc, otherNames, surname] = value.split('|').map((part) => part.trim())
  if (!nrc || !otherNames || !surname) {
    throw new CrbError('CRB_TEST_IDENTITY must be "NRC|other names|surname".', { code: 'crb_not_configured' })
  }
  return { nrc, otherNames, surname }
}

/** JAX-WS style services wrap the answer in `return`; others give it directly. */
const unwrap = (result) => (result && typeof result === 'object' && 'return' in result ? result.return : result)

export const product109Provider = {
  name: 'product109',
  label: 'Credit bureau (Product 109)',
  sample: false,

  /**
   * One Product 109 enquiry. Not retried: every call is an enquiry the bureau records
   * (and bills), and a timeout does not tell us whether it was recorded.
   *
   * @param identity  from identityFor(): { nrc, otherNames, surname }
   * @returns { score, report } as crb_reports stores them
   */
  async fetchReport(identity) {
    const missing = missingConfig()
    if (missing.length) throw new CrbError(`The credit bureau is not fully set up (missing ${missing.join(', ')}).`, { code: 'crb_not_configured' })
    const config = readConfig()
    const test = testIdentity()
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
}

/** For tests: drop the cached client so a changed WSDL or stand-in is picked up. */
export const resetProduct109Client = () => {
  cached = null
}
