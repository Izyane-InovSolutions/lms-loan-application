import crypto from 'node:crypto'

/*
 * Credit reference bureau adapter.
 *
 *   CRB_PROVIDER unset / none   no bureau; the "Run credit check" action is hidden
 *   CRB_PROVIDER=demo           deterministic sample scores for demos and testing,
 *                               clearly labelled as sample data — never for real decisions
 *
 * A real bureau (in Zambia, typically TransUnion via CRB Africa) plugs in here as another
 * provider implementing fetchReport(). It needs a bureau contract, credentials held only
 * on the server, and the applicant's recorded consent — the caller checks that.
 */

const demoProvider = {
  name: 'demo',
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
  throw new Error(`Unknown CRB_PROVIDER "${provider}". Use "demo", "none", or add the bureau's adapter in api/_lib/crb.`)
}
