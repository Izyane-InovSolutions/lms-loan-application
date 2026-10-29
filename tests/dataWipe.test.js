import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')

const prepareDraft = draftPreparer(kv, putBlob)

describe('wipe data', () => {
  const demoAdmin = client(handler)
  const admin = client(handler)
  const officer = client(handler)

  beforeAll(async () => {
    await demoAdmin.post('/auth/demo', { role: 'admin' })
    await officer.post('/auth/demo', { role: 'loan_officer' })
    // A real administrator, with a password to confirm with.
    const invite = await demoAdmin.post('/users', { name: 'Wipe Admin', email: 'wipe.admin@example.com', role: 'admin' })
    await admin.post('/auth/password/set', { token: decodeURIComponent(invite.body.inviteUrl.split('token=')[1]), password: 'wipe-admin-pass-1' })

    // Something of each kind: an application, an unfinished one, a customer account.
    const { token, body } = await prepareDraft('wiped@example.com')
    body.data.personalInfo.email = 'wiped@example.com'
    expect((await client(handler).post('/applications', body, { authorization: `Bearer ${token}` })).status).toBe(200)
    await prepareDraft('unfinished@example.com')
    const db = await getDb()
    await db.insert(schema.applicationDrafts).values({ id: crypto.randomUUID(), email: 'unfinished@example.com', loanType: 'personal', expiresAt: new Date(Date.now() + 86400000) })
    await db.insert(schema.users).values({ email: 'customer@example.com', name: 'A Customer', role: 'customer' })
  })

  it('is for administrators only', async () => {
    expect((await officer.get('/admin/wipe')).status).toBe(403)
    expect((await officer.post('/admin/wipe', { categories: ['applications'], confirm: 'WIPE' })).status).toBe(403)
  })

  it('counts what there is, and asks for the password when the account has one', async () => {
    const { body } = await admin.get('/admin/wipe')
    expect(body.needsPassword).toBe(true)
    expect(body.counts).toMatchObject({ applications: 1, drafts: 1, customers: 1 })
    expect(body.counts.auditLog).toBeGreaterThan(0)
  })

  it('refuses without the phrase, the password, or a choice', async () => {
    expect((await admin.post('/admin/wipe', { categories: [], confirm: 'WIPE', password: 'wipe-admin-pass-1' })).body.code).toBe('invalid_input')
    expect((await admin.post('/admin/wipe', { categories: ['applications'], confirm: 'wipe it', password: 'wipe-admin-pass-1' })).body.code).toBe('confirmation_required')
    expect((await admin.post('/admin/wipe', { categories: ['applications'], confirm: 'WIPE', password: 'wrong' })).body.code).toBe('invalid_password')
    expect((await admin.get('/admin/wipe')).body.counts.applications).toBe(1)
  })

  it('deletes what was chosen, keeps the rest and the configuration, and records the wipe', async () => {
    const before = (await admin.get('/settings')).body.settings.products
    const response = await admin.post('/admin/wipe', { categories: ['applications', 'drafts', 'customers', 'auditLog'], confirm: 'WIPE', password: 'wipe-admin-pass-1' })
    expect(response.status).toBe(200)
    expect(response.body.removed).toMatchObject({ applications: 1, drafts: 1, customers: 1 })

    const { counts } = (await admin.get('/admin/wipe')).body
    expect(counts).toMatchObject({ applications: 0, drafts: 0, customers: 0 })
    // The saved draft itself is gone, not just its summary.
    expect(await kv.get('draft:unfinished@example.com')).toBeFalsy()
    // Staff and settings stay.
    expect((await admin.get('/settings')).body.settings.products).toEqual(before)
    expect((await officer.get('/applications')).status).toBe(200)

    // The cleared audit log holds one entry: this wipe, by whom.
    const db = await getDb()
    const entries = await db.select().from(schema.auditLog)
    expect(entries.map((entry) => entry.action)).toEqual(['data.wiped'])
    expect(entries[0]).toMatchObject({ actorLabel: expect.stringContaining('wipe.admin@example.com'), detail: expect.objectContaining({ removed: expect.objectContaining({ applications: 1 }) }) })
  })
})
