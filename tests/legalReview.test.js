import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')

const admin = client(handler)
const legal = client(handler)
const officer = client(handler)

let caseId

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await legal.post('/auth/demo', { role: 'legal_officer' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await admin.post('/demo/seed', { count: 6 })
  const { applications } = (await admin.get('/applications?status=&pageSize=50')).body
  caseId = applications[0].id
  // A pledge, as a submission files it.
  const db = await getDb()
  const [row] = await db.select().from(schema.applications).where(eq(schema.applications.id, caseId))
  const collateral = { items: [{ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Toyota Hilux ABC 1234', value: 180000, haircut: 0.3, ltv: 0.7 }] }
  await db.update(schema.applications).set({ data: { ...row.data, collateral } }).where(eq(schema.applications.id, caseId))
})

describe('the legal officer', () => {
  it('is a built-in role that only verifies collateral and documents', async () => {
    const { user } = (await legal.get('/auth/me')).body
    expect(user.permissions).toEqual(['legal.verify'])
    // Sees the case, but can't work it.
    const detail = await legal.get(`/applications/${caseId}`)
    expect(detail.status).toBe(200)
    expect((await legal.post(`/applications/${caseId}/actions`, { action: 'note', message: 'Looks fine', version: detail.body.application.version })).status).toBe(403)
  })

  it('verifies a collateral item and records an issue with a document, on the timeline', async () => {
    const verified = await legal.post(`/applications/${caseId}/verifications`, { target: 'collateral', id: 0, status: 'verified' })
    expect(verified.status).toBe(200)
    expect(verified.body.application.verifications.collateral['0']).toMatchObject({ status: 'verified', byName: 'Mulenga Banda' })

    const document = verified.body.documents.find((entry) => entry.source !== 'system')
    expect((await legal.post(`/applications/${caseId}/verifications`, { target: 'document', id: document.id, status: 'issue' })).body.code).toBe('note_required')
    const flagged = await legal.post(`/applications/${caseId}/verifications`, { target: 'document', id: document.id, status: 'issue', note: 'Stamp is illegible' })
    // Both checks kept: one doesn't overwrite the other.
    expect(flagged.body.application.verifications).toMatchObject({ collateral: { 0: { status: 'verified' } }, documents: { [document.id]: { status: 'issue', note: 'Stamp is illegible' } } })
    expect(flagged.body.events[0].message).toMatch(/Raised an issue with the .*: Stamp is illegible/)

    const cleared = await legal.post(`/applications/${caseId}/verifications`, { target: 'collateral', id: 0, status: 'clear' })
    expect(cleared.body.application.verifications.collateral).toEqual({})
    expect((await legal.post(`/applications/${caseId}/verifications`, { target: 'collateral', id: 3, status: 'verified' })).status).toBe(404)
  })

  it('is the only one, with the administrator, who may verify', async () => {
    expect((await officer.post(`/applications/${caseId}/verifications`, { target: 'collateral', id: 0, status: 'verified' })).status).toBe(403)
    expect((await admin.post(`/applications/${caseId}/verifications`, { target: 'collateral', id: 0, status: 'verified' })).status).toBe(200)
  })
})

describe('legal sign-off before approval', () => {
  it('holds approval until every collateral item and document is verified', async () => {
    const { applications } = (await admin.get('/applications?status=pending_approval&pageSize=50')).body
    const pending = applications[0]
    const approve = async () => {
      const { version } = (await admin.get(`/applications/${pending.id}`)).body.application
      return admin.post(`/applications/${pending.id}/actions`, { action: 'decide', verdict: 'approve', rationale: 'Affordable and well secured', version })
    }
    const refused = await approve()
    expect(refused.body).toMatchObject({ code: 'legal_review_incomplete', message: expect.stringMatching(/aren’t verified yet/) })
    // The case page is told why Approve is held, while Decline stays open.
    const { workflow } = (await admin.get(`/applications/${pending.id}`)).body
    expect(workflow.actions.find((action) => action.kind === 'approve').blocked).toMatch(/^Approval waits for legal sign-off/)
    expect(workflow.actions.find((action) => action.kind === 'reject').blocked).toBeNull()

    const { documents } = (await legal.get(`/applications/${pending.id}`)).body
    const files = documents.filter((document) => document.source !== 'system')
    // An open issue holds it too.
    await legal.post(`/applications/${pending.id}/verifications`, { target: 'document', id: files[0].id, status: 'issue', note: 'Name differs from the NRC' })
    for (const document of files.slice(1)) await legal.post(`/applications/${pending.id}/verifications`, { target: 'document', id: document.id, status: 'verified' })
    expect((await approve()).body.message).toMatch(/an issue is recorded/)

    await legal.post(`/applications/${pending.id}/verifications`, { target: 'document', id: files[0].id, status: 'verified' })
    const approved = await approve()
    expect(approved.status).toBe(200)
    expect(approved.body.application.status).toBe('approved')
  })

  it('can be switched off', async () => {
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    expect((await admin.get('/settings')).body.settings.workflow.requireLegalReview).toBe(false)
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3 })
    expect((await admin.get('/settings')).body.settings.workflow.requireLegalReview).toBe(true)
  })
})
