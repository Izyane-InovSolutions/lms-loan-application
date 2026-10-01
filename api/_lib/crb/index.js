import crypto from 'node:crypto'
import { product109Provider, missingConfig as missingProduct109Config, CrbError } from './product109.js'

export { CrbError }

/*
 * Credit reference bureau adapter.
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

export const getCrb = () => {
  const provider = (process.env.CRB_PROVIDER || '').trim()
  if (!provider || provider === 'none') return null
  if (provider === 'demo') return demoProvider
  if (provider === 'product109') return product109Provider
  throw new Error(`Unknown CRB_PROVIDER "${provider}". Use "product109", "demo", "none", or add the bureau's adapter in api/_lib/crb.`)
}

/** For System health: the provider and the settings it still lacks, never their values. */
export const describeCrb = () => {
  const crb = getCrb()
  if (!crb) return { ok: false, kind: null, missing: [] }
  const missing = crb.name === 'product109' ? missingProduct109Config() : []
  const testIdentity = crb.name === 'product109' && Boolean((process.env.CRB_TEST_IDENTITY || '').trim())
  return { ok: !missing.length, kind: testIdentity ? `${crb.name} (bureau test identity)` : crb.name, missing }
}
