import crypto from 'node:crypto'
import { createProduct109Provider, missingConfig as missingProduct109Config, readConfig as readProduct109Env, CrbError } from './product109.js'
import { getSetting } from '../settings.js'

export { CrbError }

/*
 * Credit reference bureau adapter, set up in Settings → Credit bureau (the `crb` setting).
 * Its provider "environment" (the default) follows the variables below instead:
 *
 *   CRB_PROVIDER unset / none   no bureau; the "Run credit check" action is hidden
 *   CRB_PROVIDER=demo           deterministic sample scores for demos and testing,
 *                               clearly labelled as sample data — never for real decisions
 *   CRB_PROVIDER=product109     the bureau's Product 109 SOAP service (product109.js),
 *                               with credentials from the CRB_* variables
 *
 * Every provider implements fetchReport(identity) → { score, report }, where identity
 * comes from identityFor() in identity.js. The caller checks the applicant's recorded
 * consent first.
 */

const demoProvider = {
  name: 'demo',
  label: 'Sample data',
  sample: true,
  async fetchReport({ nrc, name }) {
    // Same NRC, same score: repeatable in a walkthrough, and obviously not real.
    const digest = crypto.createHash('sha256').update(String(nrc || name || 'unknown')).digest()
    const score = 350 + (digest.readUInt16BE(0) % 450)
    const accounts = 1 + (digest[2] % 5)
    const arrears = score < 500 ? 1 + (digest[3] % 3) : 0
    return {
      score,
      report: {
        sample: true,
        band: score >= 700 ? 'Very low risk' : score >= 600 ? 'Low risk' : score >= 500 ? 'Medium risk' : 'High risk',
        openAccounts: accounts,
        accountsInArrears: arrears,
        enquiriesLast6Months: digest[4] % 6,
        summary: arrears
          ? `${arrears} account${arrears === 1 ? '' : 's'} in arrears. Sample data, not a real bureau report.`
          : 'No accounts in arrears. Sample data, not a real bureau report.',
      },
    }
  },
}

/*
 * getCrb() stays synchronous for its many callers, so the stored setting is kept here
 * and refreshed at most every CACHE_MS (refreshCrb, called per API request and on save).
 * Until it is first read, the environment variables apply.
 */
const CACHE_MS = 30 * 1000
let stored = null
let loadedAt = 0

/** Re-reads the `crb` setting when it is older than CACHE_MS, or always with `force`. */
export const refreshCrb = async ({ force = false } = {}) => {
  if (!force && stored && Date.now() - loadedAt < CACHE_MS) return
  stored = await getSetting('crb')
  loadedAt = Date.now()
}

/** The Product 109 connection as the provider reads it, from a saved (decrypted) `crb` setting. */
export const product109ConfigFrom = (setting) => ({
  wsdlUrl: setting.wsdlUrl || '',
  transportUsername: setting.transportUsername || '',
  transportPassword: setting.transportPassword || '',
  messageUsername: setting.messageUsername || '',
  messagePassword: setting.messagePassword || '',
  code: setting.code || '',
  infinityCode: setting.infinityCode || '',
  reportReason: Number(setting.reportReason) || 2,
  reportSector: Number(setting.reportSector) || 2,
  timeoutMs: Math.max(5, Number(setting.timeoutSeconds) || 30) * 1000,
  // A CA bundle is a file on the server, so it is only ever set by CRB_CA_FILE.
  caFile: (process.env.CRB_CA_FILE || '').trim(),
  testIdentity: setting.testIdentity || '',
  source: 'settings',
})

/** Which bureau is in use and where its connection comes from: { source, provider, config }. */
export const resolveCrb = (setting = stored) => {
  if (!setting || setting.provider === 'environment') {
    return { source: 'environment', provider: (process.env.CRB_PROVIDER || '').trim() || 'none', config: readProduct109Env() }
  }
  return { source: 'settings', provider: setting.provider, config: product109ConfigFrom(setting) }
}

/** The provider for a resolved setup, or null when there is no bureau. */
export const crbProviderFor = ({ provider, config }) => {
  if (!provider || provider === 'none') return null
  if (provider === 'demo') return demoProvider
  if (provider === 'product109') return createProduct109Provider(config)
  throw new Error(`Unknown CRB_PROVIDER "${provider}". Use "product109", "demo", "none", or add the bureau's adapter in api/_lib/crb.`)
}

export const getCrb = () => crbProviderFor(resolveCrb())

/** For System health and Settings: the provider and what it still lacks, never the values. */
export const describeCrb = () => {
  const resolved = resolveCrb()
  const crb = crbProviderFor(resolved)
  if (!crb) return { ok: false, kind: null, missing: [], source: resolved.source }
  const missing = crb.name === 'product109' ? missingProduct109Config(resolved.config) : []
  const testIdentity = crb.name === 'product109' && Boolean((resolved.config.testIdentity || '').trim())
  return { ok: !missing.length, kind: testIdentity ? `${crb.name} (bureau test identity)` : crb.name, missing, source: resolved.source }
}
