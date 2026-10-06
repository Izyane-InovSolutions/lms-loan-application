import crypto from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { dueLabel } = await import('../src/admin/pages/DataRequestsPage.jsx')
const { eq } = await import('drizzle-orm')

const prepare = draftPreparer(kv, putBlob)
const applicant = client(handler)
const admin = client(handler)
const officer = client(handler)

const submit = async (email) => {
  const { token, body } = await prepare(email)
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('data request ledger', () => {
  it('logs a request without the email, defaults the due date to 30 days, and is permission gated', async () => {
    const email = `ledger.${crypto.randomBytes(3).toString('hex')}@example.com`
    expect((await officer.get('/admin/data-requests/ledger')).status).toBe(403)
    expect((await officer.post('/admin/data-requests/ledger', { email, type: 'access' })).status).toBe(403)

    expect((await admin.post('/admin/data-requests/ledger', { email, type: 'other' })).status).toBe(400)
    const created = await admin.post('/admin/data-requests/ledger', { email, type: 'access' })
    expect(created.status).toBe(200)
    expect(created.body.status).toBe('open')
    const days = (new Date(created.body.dueAt) - new Date(created.body.receivedAt)) / 86400000
    expect(days).toBe(30)
    expect(JSON.stringify(created.body)).not.toContain(email)

    const db = await getDb()
    const [row] = await db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, created.body.id))
    expect(JSON.stringify(row)).not.toContain(email)
    expect(row.emailHash).toMatch(/^[0-9a-f]{64}$/)

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'privacy.request_logged'))
    expect(audit.some((entry) => entry.entityId === created.body.id && !JSON.stringify(entry).includes(email))).toBe(true)
  })

  it('lists with status and type filters, sort and pagination, and updates status', async () => {
    const a = (await admin.post('/admin/data-requests/ledger', { email: 'a.list@example.com', type: 'erasure', receivedAt: new Date(Date.now() - 40 * 86400000).toISOString() })).body
    await admin.post('/admin/data-requests/ledger', { email: 'b.list@example.com', type: 'access' })

    const overdue = (await admin.get('/admin/data-requests/ledger?type=erasure&status=open&sort=due')).body
    expect(overdue.items.some((item) => item.id === a.id)).toBe(true)
    expect(overdue.items.every((item) => item.type === 'erasure')).toBe(true)
    expect(overdue.overdue).toBeGreaterThanOrEqual(1)

    const paged = (await admin.get('/admin/data-requests/ledger?pageSize=1&page=2')).body
    expect(paged.items).toHaveLength(1)
    expect(paged.total).toBeGreaterThan(1)
    const sorted = (await admin.get('/admin/data-requests/ledger?sort=due&dir=asc&pageSize=100')).body.items.map((item) => item.dueAt)
    expect([...sorted].sort()).toEqual(sorted)

    expect((await admin.patch(`/admin/data-requests/ledger/${a.id}`, { status: 'rejected' })).status).toBe(400)
    const done = await admin.patch(`/admin/data-requests/ledger/${a.id}`, { status: 'rejected', outcome: 'Identity not verified' })
    expect(done.body).toMatchObject({ status: 'rejected', outcome: 'Identity not verified' })
    expect(done.body.completedAt).toBeTruthy()
    expect((await admin.patch('/admin/data-requests/ledger/not-an-id', { status: 'open' })).status).toBe(404)
    expect((await admin.get('/admin/data-requests/ledger?status=active&pageSize=100')).body.items.some((item) => item.id === a.id)).toBe(false)
  })

  it('links searches, exports and erasure to an entry, and refuses another person’s entry', async () => {
    const email = 'linked@example.com'
    await submit(email)
    const request = (await admin.post('/admin/data-requests/ledger', { email, type: 'erasure' })).body
    const other = (await admin.post('/admin/data-requests/ledger', { email: 'someone.else@example.com', type: 'erasure' })).body

    expect((await admin.get(`/admin/data-requests?email=${email}&requestId=${other.id}`)).status).toBe(400)
    expect((await admin.get(`/admin/data-requests?email=${email}&requestId=${crypto.randomUUID()}`)).status).toBe(404)

    expect((await admin.get(`/admin/data-requests?email=${email}&requestId=${request.id}`)).status).toBe(200)
    const db = await getDb()
    const status = async () => (await db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, request.id)))[0].status
    expect(await status()).toBe('in_progress')
    expect((await admin.get(`/admin/data-requests/export?email=${email}&requestId=${request.id}`)).status).toBe(200)

    const erased = await admin.post('/admin/data-requests/erase', { email, confirm: email, requestId: request.id })
    expect(erased.status).toBe(200)
    expect(await status()).toBe('completed')
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'privacy.erased'))
    expect(audit.some((entry) => entry.detail.requestId === request.id)).toBe(true)
  })
})

describe('erasure preview and retention explanation', () => {
  it('counts what would be erased per category without erasing', async () => {
    const email = 'preview@example.com'
    const filed = await submit(email)
    const preview = (await admin.get(`/admin/data-requests/preview?email=${email}`)).body
    expect(preview.canErase).toBe(true)
    expect(preview.counts).toMatchObject({ applications: 1, draft: 0 })
    expect(preview.counts.documents).toBeGreaterThan(0)
    expect(preview.counts.consents).toBeGreaterThan(0)
    expect(preview.counts.locations).toBe(1)
    expect(preview.counts).toHaveProperty('crbReports')
    expect((await admin.get('/admin/data-requests?email=preview@example.com')).body.applications).toHaveLength(1)
    expect((await officer.get(`/admin/data-requests/preview?email=${email}`)).status).toBe(403)
    expect((await admin.get('/admin/data-requests/preview')).status).toBe(400)
    expect(filed.id).toBeTruthy()
  })

  it('explains which loan record is kept, and why, using the retention settings', async () => {
    const email = 'kept@example.com'
    const filed = await submit(email)
    const db = await getDb()
    await db.update(schema.applications).set({ status: 'disbursed' }).where(eq(schema.applications.id, filed.id))

    await admin.put('/settings/retention', { declinedDays: 180, withdrawnDays: 90, expiredDays: 90, disbursedDays: null, auditLogDays: null })
    let summary = (await admin.get(`/admin/data-requests?email=${email}`)).body
    expect(summary.canErase).toBe(false)
    expect(summary.keptDetails[0]).toMatchObject({ reference: filed.reference, keptUntil: null })
    expect(summary.keptDetails[0].reason).toContain('indefinitely')

    await admin.put('/settings/retention', { declinedDays: 180, withdrawnDays: 90, expiredDays: 90, disbursedDays: 365, auditLogDays: null })
    summary = (await admin.get(`/admin/data-requests?email=${email}`)).body
    expect(summary.keptDetails[0].reason).toContain('365 days')
    expect(summary.keptDetails[0].keptUntil).toBeTruthy()

    const refused = await admin.post('/admin/data-requests/erase', { email, confirm: email })
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('retention_required')
    expect(refused.body.message).toContain('365 days')
  })
})

describe('due countdown', () => {
  it('counts down, flags overdue, and shows nothing once closed', () => {
    const now = Date.parse('2026-01-31T12:00:00Z')
    expect(dueLabel({ status: 'open', dueAt: '2026-02-05T12:00:00Z' }, now)).toEqual({ overdue: false, text: '5 days left' })
    expect(dueLabel({ status: 'open', dueAt: '2026-01-31T12:00:00Z' }, now).text).toBe('Due today')
    expect(dueLabel({ status: 'in_progress', dueAt: '2026-01-28T12:00:00Z' }, now)).toEqual({ overdue: true, text: 'Overdue by 3 days' })
    expect(dueLabel({ status: 'completed', dueAt: '2026-01-01T00:00:00Z' }, now)).toBeNull()
  })
})
