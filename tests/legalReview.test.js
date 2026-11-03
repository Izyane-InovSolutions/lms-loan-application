import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF, createMemoryKv, client, draftPreparer, signaturePng } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: draftDocumentsHandler } = await import('../api/draft/documents.js')
const { putBlob } = await import('../api/_lib/blob.js')
const prepareDraft = draftPreparer(kv, putBlob)
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
  let pendingId
  const approveAs = (who, id) => async () => {
    const { version } = (await who.get(`/applications/${id}`)).body.application
    return who.post(`/applications/${id}/actions`, { action: 'decide', verdict: 'approve', rationale: 'Affordable and well secured', version })
  }

  it('doesn’t hold an unsecured loan: there is nothing to value or for legal to check', async () => {
    const { applications } = (await admin.get('/applications?status=pending_approval&pageSize=50')).body
    pendingId = applications.find((application) => application.id !== caseId).id
    const detail = (await admin.get(`/applications/${pendingId}`)).body
    expect(detail.workflow.state.approvalHold).toBeNull()
    expect(detail.workflow.actions.find((action) => action.kind === 'approve').blocked).toBeNull()
  })

  it('holds a secured loan until its collateral is valued and verified, with its proof files', async () => {
    const pending = { id: pendingId }
    // The same case, now pledging a vehicle, with one proof file.
    const db = await getDb()
    const [row] = await db.select().from(schema.applications).where(eq(schema.applications.id, pending.id))
    const collateral = { items: [{ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Toyota Hilux ABC 1234', value: 180000, haircut: 0.3, ltv: 0.7 }] }
    await db.update(schema.applications).set({ data: { ...row.data, collateral } }).where(eq(schema.applications.id, pending.id))
    const [proof] = await db
      .insert(schema.applicationDocuments)
      .values({ applicationId: pending.id, slot: 'collateral.0.0', docType: 'collateral', label: 'Collateral 1 proof 1', pathname: 'x', url: 'x', filename: 'whitebook.pdf', source: 'applicant' })
      .returning()
    const approve = approveAs(admin, pending.id)

    const refused = await approve()
    expect(refused.body).toMatchObject({ code: 'approval_held', message: expect.stringMatching(/^Approval waits for a valuation of Collateral 1: Passenger vehicle; and legal sign-off: 2 items aren’t verified yet/) })
    // The case page is told why Approve is held, while Decline stays open; only the collateral counts, not the payslips.
    const { workflow } = (await admin.get(`/applications/${pending.id}`)).body
    expect(workflow.actions.find((action) => action.kind === 'approve').blocked).toMatch(/^Approval waits for a valuation/)
    expect(workflow.state.approvalHold).not.toMatch(/payslips/i)
    expect(workflow.actions.find((action) => action.kind === 'reject').blocked).toBeNull()

    await officer.put(`/applications/${pending.id}/valuations/0`, { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 170000 })
    expect((await approve()).body.message).toMatch(/^Approval waits for legal sign-off/)
    // An open issue holds it too.
    await legal.post(`/applications/${pending.id}/verifications`, { target: 'collateral', id: 0, status: 'verified' })
    await legal.post(`/applications/${pending.id}/verifications`, { target: 'document', id: proof.id, status: 'issue', note: 'White book in another name' })
    expect((await approve()).body.message).toMatch(/an issue is recorded/)
    await legal.post(`/applications/${pending.id}/verifications`, { target: 'document', id: proof.id, status: 'verified' })
    const approved = await approve()
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.application.status).toBe('approved')
  })

  it('can be switched off', async () => {
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    expect((await admin.get('/settings')).body.settings.workflow.requireLegalReview).toBe(false)
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3 })
    expect((await admin.get('/settings')).body.settings.workflow.requireLegalReview).toBe(true)
  })
})

describe('comments on the legal review', () => {
  it('lets legal and the officers comment on each item, kept in order and on the timeline', async () => {
    const first = await legal.post(`/applications/${caseId}/verifications/comments`, { target: 'collateral', id: 0, text: 'Title deed checked at the Lands office.' })
    expect(first.status).toBe(200)
    const reply = await officer.post(`/applications/${caseId}/verifications/comments`, { target: 'collateral', id: 0, text: 'Thanks — is the valuation recent?' })
    const thread = reply.body.application.verifications.comments['collateral:0']
    expect(thread.map((entry) => [entry.byName, entry.text])).toEqual([
      ['Mulenga Banda', 'Title deed checked at the Lands office.'],
      ['Mwila Sakala', 'Thanks — is the valuation recent?'],
    ])
    expect(reply.body.events[0].message).toMatch(/^On collateral item 1 .*: Thanks/)
    // Comments sit beside the checks without disturbing them.
    expect(reply.body.application.verifications.collateral['0']).toMatchObject({ status: 'verified' })

    const document = reply.body.documents.find((entry) => entry.source !== 'system')
    const onDocument = await legal.post(`/applications/${caseId}/verifications/comments`, { target: 'document', id: document.id, text: 'Stamp is faint but legible.' })
    expect(onDocument.body.application.verifications.comments[`document:${document.id}`]).toHaveLength(1)
    expect((await legal.post(`/applications/${caseId}/verifications/comments`, { target: 'collateral', id: 0, text: ' ' })).status).toBe(400)

    const rm = client(handler)
    await rm.post('/auth/demo', { role: 'rm' })
    expect((await rm.post(`/applications/${caseId}/verifications/comments`, { target: 'collateral', id: 0, text: 'Hello' })).status).toBe(403)
  })
})

describe('several proof files per collateral item', () => {
  it('takes photos as proof in the draft, and files every proof for the legal officer', async () => {
    // Collateral optional on the personal loan, so this application can pledge some.
    const personal = (await admin.get('/settings')).body.settings.products.personal || {}
    const { buildProducts } = await import('../src/config/loanProducts.js')
    const { steps, requiredDocuments, ...product } = buildProducts({ personal }).find((entry) => entry.id === 'personal')
    expect((await admin.put('/settings/products', { personal: { ...product, collateral: { requirement: 'optional', types: [], mustCover: false } } })).status).toBe(200)

    const email = 'proofs@example.com'
    const { token, body } = await prepareDraft(email)
    const drafts = client(draftDocumentsHandler)
    // A photo is accepted as a collateral proof (it isn't for a payslip).
    const photo = await drafts.upload('/api/draft/documents', { filename: 'car.png', contentType: 'image/png', data: signaturePng(), fields: { fieldKey: 'personal.documents.collateral.0.1' } }, { authorization: `Bearer ${token}` })
    expect(photo.status).toBe(200)
    const rejected = await drafts.upload('/api/draft/documents', { filename: 'pay.png', contentType: 'image/png', data: signaturePng(), fields: { fieldKey: 'personal.documents.payslips' } }, { authorization: `Bearer ${token}` })
    expect(rejected.status).toBe(400)
    const deed = await drafts.upload('/api/draft/documents', { filename: 'deed.pdf', contentType: 'application/pdf', data: PDF, fields: { fieldKey: 'personal.documents.collateral.0.0' } }, { authorization: `Bearer ${token}` })
    expect(deed.status).toBe(200)

    body.data.collateral = { items: [{ code: 'MV-CAR', description: 'Toyota Hilux ABC 1234', value: 180000 }] }
    body.data.documents.collateral = [[{ __draftFile__: 'personal.documents.collateral.0.0' }, { __draftFile__: 'personal.documents.collateral.0.1' }]]
    const filed = await client(handler).post('/applications', body, { authorization: `Bearer ${token}` })
    expect(filed.status).toBe(200)
    const { documents } = (await legal.get(`/applications/${filed.body.id}`)).body
    expect(documents.filter((entry) => entry.slot.startsWith('collateral.')).map((entry) => [entry.slot, entry.label, entry.contentType])).toEqual(
      expect.arrayContaining([
        ['collateral.0.0', 'Collateral 1 proof 1', 'application/pdf'],
        ['collateral.0.1', 'Collateral 1 proof 2', 'image/png'],
      ])
    )
  })
})

describe('collateral valuations (Appraisal)', () => {
  it('records a valuation, lends on its market value, and files the valuer’s report', async () => {
    // caseId pledged a vehicle the applicant put at K180,000.
    const unvalued = (await officer.get(`/applications/${caseId}`)).body
    expect(unvalued.application.valuations).toEqual({})
    expect((await legal.put(`/applications/${caseId}/valuations/0`, { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 150000 })).status).toBe(403)
    expect((await officer.put(`/applications/${caseId}/valuations/0`, { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 150000, forcedSaleValue: 200000 })).body.message).toMatch(/can’t be more than the market value/)
    expect((await officer.put(`/applications/${caseId}/valuations/3`, { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 150000 })).status).toBe(404)

    const valued = await officer.put(`/applications/${caseId}/valuations/0`, { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 150000, forcedSaleValue: 110000, inspectedOn: '2026-10-29', notes: 'Good condition, no encumbrances.' })
    expect(valued.status).toBe(200)
    expect(valued.body.application.valuations['0']).toMatchObject({ valuer: 'Knight Frank', marketValue: 150000, forcedSaleValue: 110000, inspectedOn: '2026-10-29', byName: 'Mwila Sakala' })
    expect(valued.body.events.find((event) => event.type === 'valuation').message).toMatch(/^Valued collateral item 1 .* at K150,000 \(the applicant estimated K180,000\), by Knight Frank, inspected 2026-10-29/)
    // Lent on the valuer's figure: 150,000 less 30% haircut, at 70% LTV.
    expect(valued.body.prescreen.facts).toMatchObject({ collateral_lending_value: 73500, collateral_unvalued: 0 })

    const report = await officer.upload(`/applications/${caseId}/valuations/0/report`, { filename: 'valuation.pdf', contentType: 'application/pdf', data: PDF })
    expect(report.status).toBe(200)
    const filed = report.body.documents.find((document) => document.slot === 'valuation.0')
    expect(filed).toMatchObject({ label: 'Collateral 1 valuation report', source: 'staff' })
    expect(report.body.application.valuations['0'].reportId).toBe(filed.id)
    // The lender's own report isn't one the legal officer must verify.
    const { reviewableDocuments } = await import('../src/config/legalReview.js')
    expect(reviewableDocuments(report.body.documents).some((document) => document.slot === 'valuation.0')).toBe(false)
  })

  it('names an unvalued item as what holds approval', async () => {
    const { approvalHold } = await import('../src/config/appraisal.js')
    const application = { data: { collateral: { items: [{ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Hilux', value: 1 }] } }, valuations: {}, verifications: {} }
    expect(approvalHold(application, [], undefined, { requireLegalReview: false })).toBe('a valuation of Collateral 1: Passenger vehicle')
    expect(approvalHold({ ...application, valuations: { 0: { marketValue: 5 } } }, [], undefined, { requireLegalReview: false })).toBeNull()
    expect(approvalHold(application, [], undefined, { requireLegalReview: false, requireValuation: false })).toBeNull()
    // Unsecured: nothing to value.
    expect(approvalHold({ data: {}, valuations: {} }, [], undefined, { requireLegalReview: false })).toBeNull()
  })
})

describe('security for the LMS', () => {
  it('lists each collateral item with its valuation, and each guarantor', async () => {
    const { securityLists } = await import('../api/_lib/lms/sync.js')
    const application = {
      data: {
        collateral: { items: [{ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Toyota Hilux ABC 1234', value: 180000, haircut: 0.3, ltv: 0.7 }] },
        guarantors: [{ name: 'Mutale Chanda', nrc: '234567/89/1', phone: '971234569', email: '', relationship: 'Sibling', address: 'Roma, Lusaka' }],
      },
      valuations: { 0: { valuer: 'Knight Frank', valuedOn: '2026-10-30', marketValue: 150000, forcedSaleValue: 110000, inspectedOn: '2026-10-29' } },
    }
    expect(securityLists(application)).toEqual({
      collateral_items: [
        {
          collateral_code: 'MV-CAR',
          collateral_type: 'Motor vehicle',
          collateral_name: 'Passenger vehicle',
          description: 'Toyota Hilux ABC 1234',
          stated_value: 180000,
          market_value: 150000,
          forced_sale_value: 110000,
          valuer: 'Knight Frank',
          valued_on: '2026-10-30',
          inspected_on: '2026-10-29',
          haircut_percent: 30,
          loan_to_value_percent: 70,
          lending_value: 73500,
        },
      ],
      guarantors: [{ full_name: 'Mutale Chanda', nrc: '234567/89/1', phone: '971234569', email: '', relationship: 'Sibling', address: 'Roma, Lusaka' }],
    })
  })
})
