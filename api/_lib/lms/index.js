import { createFrappeLms, LmsError } from './frappe.js'
import { getSetting, SETTING_DEFAULTS } from '../settings.js'

export { LmsError }

const env = (name) => (process.env[name] || '').trim()

/**
 * How to reach the LMS, from Settings → LMS connection when it is switched on there,
 * otherwise from environment variables (LMS_BASE_URL with LMS_API_KEY/LMS_API_SECRET or
 * LMS_USERNAME/LMS_PASSWORD). Null when neither is configured: the workspace then runs
 * on its own and nothing is handed over.
 */
export const getLmsConfig = async () => {
  const saved = await getSetting('lmsConnection').catch(() => null)
  if (saved?.enabled && saved.baseUrl) return { ...saved, source: 'settings' }

  const provider = env('LMS_PROVIDER') || (env('LMS_BASE_URL') ? 'frappe' : 'none')
  if (provider === 'none' || !env('LMS_BASE_URL')) return null
  const defaults = SETTING_DEFAULTS.lmsConnection
  const apiKey = env('LMS_API_KEY')
  return {
    ...defaults,
    enabled: true,
    source: 'environment',
    provider,
    baseUrl: env('LMS_BASE_URL'),
    authMethod: apiKey ? 'token' : 'password',
    apiKey,
    apiSecret: env('LMS_API_SECRET'),
    username: env('LMS_USERNAME'),
    password: process.env.LMS_PASSWORD || '',
  }
}

const hasCredentials = (config) =>
  config.authMethod === 'token' ? Boolean(config.apiKey && config.apiSecret) : Boolean(config.username && config.password)

/** The configured LMS client, or null. */
export const getLms = async () => {
  const config = await getLmsConfig()
  if (!config || !hasCredentials(config)) return null
  if (config.provider !== 'frappe') throw new Error(`Unknown LMS provider "${config.provider}".`)
  return createFrappeLms(config)
}

/** For Settings: whether an LMS is set up, and from where, without exposing credentials. */
export const describeLms = async () => {
  const config = await getLmsConfig()
  if (!config) return { connected: false, source: null }
  return { connected: hasCredentials(config), source: config.source, baseUrl: config.baseUrl, missingCredentials: !hasCredentials(config) }
}
