import { describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// No LMS while the case is made; a fake one reporting the payout for the pull.
const lms = { current: null }
vi.mock('../api/_lib/lms/index.js', async (importOriginal) => ({ ...(await importOriginal()), getLms: async () => lms.current }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { pullDisbursements } = await import('../api/_lib/lms/sync.js')
const { lusakaDate } = await import('../src/config/loanTerms.js')

const prepareDraft = draftPreparer(kv, putBlob)
const applicant = client(handler)

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}

describe('a payout the LMS reports', () => {
  it('dates the schedule from the payout day, as a payout made here does', async () => {
    const db = await getDb()
    const terms = { amount: 8000, tenure: 6, frequency: 'monthly', annualRate: 24, interestType: 'fixed', calculation: 'flat', effectiveDate: '2099-01-10', charges: [] }
    const withTerms = await submit('lms-paid-terms@example.com')
    const without = await submit('lms-paid-plain@example.com')
    for (const [id, extra] of [[withTerms, { terms, approvedAmount: 8000, approvedTenure: 6 }], [without, {}]]) {
      await db.update(schema.applications).set({ status: 'accepted', lmsSyncStatus: 'synced', lmsReference: `LMS-${id}`, ...extra }).where(eq(schema.applications.id, id))
    }
    lms.current = { statusOf: async () => ({ disbursed: true, status: 'Disbursed' }) }
    try {
      expect((await pullDisbursements()).disbursed).toBe(2)
    } finally {
      lms.current = null
    }
    const [paid] = await db.select().from(schema.applications).where(eq(schema.applications.id, withTerms))
    expect(paid.status).toBe('disbursed')
    expect(paid.terms).toMatchObject({ amount: 8000, effectiveDate: '2099-01-10', paidOutOn: lusakaDate() })
    const [plain] = await db.select().from(schema.applications).where(eq(schema.applications.id, without))
    expect(plain.status).toBe('disbursed')
    expect(plain.terms ?? null).toBeNull()
  })
})
