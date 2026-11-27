import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF, createMemoryKv, client, draftPreparer, emailCode } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { lendingCover } = await import('../src/config/appraisal.js')
const { LEGAL_CHECKS, underwritingStatus } = await import('../src/config/underwriting.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const legal = client(handler)
const applicant = client(handler)

const pdf = { filename: 'file.pdf', contentType: 'application/pdf', data: PDF }
const vehicle = { code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Toyota Hilux ABC 1234', value: 180000, haircut: 0.3, ltv: 0.7 }

const act = async (who, id, action, extra = {}) => {
  const { version } = (await admin.get(`/applications/${id}`)).body.application
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}
const view = async (id, who = officer) => (await who.get(`/applications/${id}`)).body
const approve = (id) => act(officer, id, 'transition', { actionId: 'underwritten' })
const verifyDocument = (who, id, documentId, status = 'verified') => who.post(`/applications/${id}/verifications`, { target: 'document', id: documentId, status })

/** A submitted case taken through Appraisal to Underwriting; with `collateral`, pledging it. */
const toUnderwriting = async (email, { collateral = null } = {}) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  const id = response.body.id
  if (collateral) {
    const db = await getDb()
    const [row] = await db.select().from(schema.applications).where(eq(schema.applications.id, id))
    await db.update(schema.applications).set({ data: { ...row.data, collateral: { items: collateral } } }).where(eq(schema.applications.id, id))
  }
  for (const [action, extra] of [['start_review', {}], ['save_terms', {}], ['transition', { actionId: 'appraised' }]]) {
    const moved = await act(officer, id, action, extra)
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
  }
  return id
}

const allChecks = Object.fromEntries(LEGAL_CHECKS.map(([key]) => [key, { done: true, note: '' }]))
const legalRecord = (checks = allChecks) => ({
  title: { number: 'ABC 1234', owner: 'Ada Banda', details: 'Registered at RTSA' },
  verifiedBy: { name: 'Mulenga Banda', firm: 'Banda & Co', role: 'advocate', licence: 'LAZ-0042' },
  checks,
  remark: 'Clean title',
})

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await legal.post('/auth/demo', { role: 'legal_officer' })
})

describe('underwriting an unsecured loan', () => {
  it('needs only document verification, which the loan officer does', async () => {
    const id = await toUnderwriting('uw-plain@example.com')
    const { workflow } = await view(id)
    expect(workflow.state.work).toBe('underwriting')
    expect(workflow.state.underwritingRequires).toEqual({ requireValuation: true, requireLegalReview: true })
    const { underwriting } = workflow.state
    expect(underwriting.valuation).toEqual([])
    expect(underwriting.legal).toEqual([])
    expect(underwriting.documents.length).toBeGreaterThan(1)
    expect(underwriting.documents.every((document) => document.status === 'unchecked')).toBe(true)
    expect(underwriting.complete).toBe(false)
    expect(workflow.actions.find((action) => action.id === 'underwritten').blocked).toMatch(/^Moves on once underwriting is complete: /)

    const refused = await approve(id)
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('underwriting_incomplete')
    expect(refused.body.message).toMatch(/^Moving on waits for: /)

    const [last, ...rest] = underwriting.documents
    for (const document of rest) expect((await verifyDocument(officer, id, document.id)).status).toBe(200)
    expect((await approve(id)).body.code).toBe('underwriting_incomplete')
    expect((await verifyDocument(officer, id, last.id)).status).toBe(200)
    const after = (await view(id)).workflow.state.underwriting
    expect(after).toMatchObject({ complete: true, hold: null })
    const approved = await approve(id)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.application.state).toBe('decision')
  })

  it('needs a fresh check of a document the applicant sends again', async () => {
    const id = await toUnderwriting('uw-again@example.com')
    for (const document of (await view(id)).workflow.state.underwriting.documents) await verifyDocument(officer, id, document.id)
    expect((await view(id)).workflow.state.underwriting.complete).toBe(true)

    expect((await act(officer, id, 'request_info', { documents: ['nrcCopy'] })).status).toBe(200)
    const customer = client(handler)
    await emailCode(kv, 'login', 'uw-again@example.com', '333444')
    await customer.post('/auth/customer', { email: 'uw-again@example.com', code: '333444' })
    expect((await customer.upload(`/me/applications/${id}/documents`, { ...pdf, filename: 'nrc-new.pdf', fields: { slot: 'nrcCopy' } })).status).toBe(200)
    expect((await customer.post(`/me/applications/${id}/respond`, { message: 'New scan attached.' })).status).toBe(200)

    const { documents, workflow } = await view(id)
    const newest = documents.find((document) => document.slot === 'nrcCopy' && !document.supersededBy)
    const nrc = workflow.state.underwriting.documents.find((document) => document.id === newest.id)
    expect(nrc.status).toBe('unchecked')
    expect(workflow.state.underwriting.documents.filter((document) => document.label === nrc.label)).toHaveLength(1)
    expect(workflow.state.underwriting.complete).toBe(false)
    expect((await approve(id)).body.code).toBe('underwriting_incomplete')
  })
})

describe('underwriting a secured loan', () => {
  let id

  it('holds the valuation until its report is attached', async () => {
    id = await toUnderwriting('uw-secured@example.com', { collateral: [vehicle] })
    const { underwriting } = (await view(id)).workflow.state
    expect(underwriting.valuation).toEqual([expect.objectContaining({ index: 0, label: 'Collateral 1: Passenger vehicle', complete: false })])
    expect(underwriting.legal).toEqual([expect.objectContaining({ index: 0, complete: false })])

    const valuation = { asset: { type: 'Motor vehicle', assetId: 'ABC 1234', owner: 'Ada Banda', description: 'Toyota Hilux ABC 1234', location: 'Lusaka' }, valuationAmount: 5000, method: 'market', marketValue: 5000, forcedSaleValue: 4000, valuedOn: '2026-10-30', valuer: 'J. Phiri', valuerCompany: 'Knight Frank', valuerLicence: 'VSZ-11', valuerContact: '0977 000000', remark: 'Fair condition' }
    const early = await officer.put(`/applications/${id}/valuations/0`, valuation)
    expect(early.status).toBe(400)
    expect(early.body).toMatchObject({ code: 'report_required', message: 'Attach the valuation report first.' })

    expect((await officer.upload(`/applications/${id}/valuations/0/report`, pdf)).status).toBe(200)
    const saved = await officer.put(`/applications/${id}/valuations/0`, valuation)
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.application.valuations[0]).toMatchObject({ ...valuation, reportId: expect.any(String) })
    expect(saved.body.workflow.state.underwriting.valuation[0]).toMatchObject({ complete: true, missing: [] })
  })

  it('is the legal officer’s to verify the title', async () => {
    const refused = await officer.put(`/applications/${id}/legal/0`, legalRecord())
    expect(refused.status).toBe(403)
    expect((await officer.upload(`/applications/${id}/legal/0/documents/title_deed`, pdf)).status).toBe(403)
  })

  it('holds Approve until the legal verification and documents are complete', async () => {
    for (const document of (await view(id)).workflow.state.underwriting.documents) expect((await verifyDocument(officer, id, document.id)).status).toBe(200)

    const first = await legal.upload(`/applications/${id}/legal/0/documents/title_deed`, pdf)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const replaced = await legal.upload(`/applications/${id}/legal/0/documents/title_deed`, { ...pdf, filename: 'deed-2.pdf' })
    const titleDeed = replaced.body.application.verifications.legal[0].documents.title_deed
    expect(titleDeed).toMatchObject({ label: 'Title deed / ownership document', required: true })
    expect(titleDeed.documentId).not.toBe(first.body.application.verifications.legal[0].documents.title_deed.documentId)
    expect(replaced.body.documents.find((document) => document.id === titleDeed.documentId)).toMatchObject({ slot: 'legal.0.title_deed' })

    const partial = await legal.put(`/applications/${id}/legal/0`, legalRecord({ ...allChecks, litigation: { done: false, note: 'Search pending' } }))
    expect(partial.status, JSON.stringify(partial.body)).toBe(200)
    expect(partial.body.application.verifications.legal[0]).toMatchObject({ title: { number: 'ABC 1234' }, verifiedBy: { role: 'advocate' }, checks: { litigation: { done: false, note: 'Search pending' } }, byName: 'Mulenga Banda' })
    const status = partial.body.workflow.state.underwriting.legal[0]
    expect(status.complete).toBe(false)
    expect(status.missing).toEqual(expect.arrayContaining(['Search report', 'Litigation check']))
    const held = await approve(id)
    expect(held.body.code).toBe('underwriting_incomplete')
    expect(held.body.message).toContain('Litigation check')

    expect((await legal.upload(`/applications/${id}/legal/0/documents/search_report`, pdf)).status).toBe(200)
    const done = await legal.put(`/applications/${id}/legal/0`, legalRecord())
    expect(done.status).toBe(200)
    expect(done.body.workflow.state.underwriting.legal[0]).toMatchObject({ complete: true, missing: [] })
    expect(done.body.workflow.state.underwriting.complete).toBe(true)
    // The documents survive a save of the record.
    expect(done.body.application.verifications.legal[0].documents.title_deed.documentId).toBe(titleDeed.documentId)

    // Valued at K5,000 against K5,000 of terms: short on cover, which never holds Approve.
    const { application } = await view(id, admin)
    expect(lendingCover(application).short).toBe(true)
    const approved = await approve(id)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
  })

  it('is approved at the decision on underwriting’s records, without the older per-item legal check', async () => {
    const approver = client(handler)
    await approver.post('/auth/demo', { role: 'sales_manager' })
    const { workflow, application } = await view(id)
    expect(application.state).toBe('decision')
    expect(application.verifications.collateral ?? {}).toEqual({})
    expect(workflow.state.approvalHold).toBeNull()
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    const recommended = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect(recommended.status, JSON.stringify(recommended.body)).toBe(200)
    const decided = await act(approver, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    expect(decided.body.application.status).toBe('approved')
  })

  it('holds the decision when an asset’s legal verification is taken back since', async () => {
    const other = await toUnderwriting('uw-taken-back@example.com', { collateral: [vehicle] })
    expect((await officer.upload(`/applications/${other}/valuations/0/report`, pdf)).status).toBe(200)
    expect((await officer.put(`/applications/${other}/valuations/0`, { marketValue: 200000, valuedOn: '2026-10-30' })).status).toBe(200)
    for (const slot of ['title_deed', 'search_report']) expect((await legal.upload(`/applications/${other}/legal/0/documents/${slot}`, pdf)).status).toBe(200)
    expect((await legal.put(`/applications/${other}/legal/0`, legalRecord())).status).toBe(200)
    for (const document of (await view(other)).workflow.state.underwriting.documents) await verifyDocument(officer, other, document.id)
    expect((await approve(other)).status).toBe(200)
    // The legal officer unticks a check after Underwriting.
    expect((await legal.put(`/applications/${other}/legal/0`, legalRecord({ ...allChecks, encumbrance: { done: false, note: 'Caveat found' } }))).status).toBe(200)
    const { workflow } = await view(other)
    expect(workflow.state.approvalHold).toMatch(/Existing encumbrance check/)
    expect(workflow.state.approvalHold).not.toMatch(/legal sign-off/)
  })

  it('accepts the older valuation and per-item legal check on a case carried over from before underwriting', async () => {
    const approver = client(handler)
    await approver.post('/auth/demo', { role: 'sales_manager' })
    const carried = await toUnderwriting('uw-carried@example.com', { collateral: [vehicle] })
    const db = await getDb()
    const [row] = await db.select().from(schema.applications).where(eq(schema.applications.id, carried))
    // As the older appraisal and legal review left them: no method, no report, no legal record.
    const [proofRow] = await db
      .insert(schema.applicationDocuments)
      .values({ applicationId: carried, slot: 'collateral.0.0', docType: 'collateral', label: 'Collateral 1 proof', pathname: 'x/logbook.pdf', url: 'memory://logbook.pdf', filename: 'logbook.pdf', contentType: 'application/pdf', size: PDF.length, source: 'applicant' })
      .returning()
    const proofId = proofRow.id
    await db
      .update(schema.applications)
      .set({
        valuations: { 0: { valuer: 'J. Phiri', valuedOn: '2026-10-30', marketValue: 200000, forcedSaleValue: null, inspectedOn: null, notes: null, by: 'x', byName: 'Old officer', at: '2026-10-30T10:00:00.000Z' } },
        verifications: { ...(row.verifications || {}), collateral: { 0: { status: 'verified', note: '', by: 'x', byName: 'Old legal', at: '2026-10-30T10:00:00.000Z' } }, documents: { ...(row.verifications?.documents || {}), [proofId]: { status: 'issue', note: 'Logbook name differs' } } },
      })
      .where(eq(schema.applications.id, carried))
    for (const document of (await view(carried)).workflow.state.underwriting.documents) await verifyDocument(officer, carried, document.id)

    {
      // An issue left open on one of the item's proof files still holds it.
      const held = (await view(carried)).workflow.state.underwriting
      expect(held.legal[0].complete).toBe(false)
      expect((await approve(carried)).body.code).toBe('underwriting_incomplete')
      const [now] = await db.select().from(schema.applications).where(eq(schema.applications.id, carried))
      const { [proofId]: _issue, ...rest } = now.verifications.documents
      await db.update(schema.applications).set({ verifications: { ...now.verifications, documents: { ...rest, [proofId]: { status: 'verified', note: '' } } } }).where(eq(schema.applications.id, carried))
    }

    const { underwriting } = (await view(carried)).workflow.state
    expect(underwriting.valuation[0]).toMatchObject({ complete: true, earlier: true })
    expect(underwriting.legal[0]).toMatchObject({ complete: true, earlier: true })
    expect(underwriting.complete).toBe(true)
    const moved = await approve(carried)
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(moved.body.application.state).toBe('decision')
    expect((await view(carried)).workflow.state.approvalHold).toBeNull()

    for (const check of ['identity', 'documents', 'income']) await act(officer, carried, 'check', { check, done: true, note: 'Seen' })
    const recommended = await act(officer, carried, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect(recommended.status, JSON.stringify(recommended.body)).toBe(200)
    expect(recommended.body.application.state).toBe('pending_approval')
    const decided = await act(approver, carried, 'decide', { verdict: 'approve', rationale: 'Agreed' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    expect(decided.body.application.status).toBe('approved')
  })

  it('refuses legal saves and uploads on a closed case', async () => {
    const closed = await toUnderwriting('uw-closed@example.com', { collateral: [vehicle] })
    const db = await getDb()
    await db.update(schema.applications).set({ status: 'declined' }).where(eq(schema.applications.id, closed))
    const saved = await legal.put(`/applications/${closed}/legal/0`, legalRecord())
    expect(saved.status).toBe(409)
    expect(saved.body.code).toBe('invalid_state')
    const uploaded = await legal.upload(`/applications/${closed}/legal/0/documents/title_deed`, pdf)
    expect(uploaded.status).toBe(409)
    expect(uploaded.body.code).toBe('invalid_state')
  })

  it('records its saves in the audit log', async () => {
    const { entries } = (await admin.get('/audit?action=application.')).body
    const actions = (entries || []).map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['application.legal_saved', 'application.legal_document_added']))
  })
})

describe('lendingCover', () => {
  const application = (amount, marketValue = 100000) => ({ data: { collateral: { items: [vehicle] } }, valuations: { 0: { marketValue } }, terms: { amount } })

  it('is short when the terms amount is above the lending value', () => {
    expect(lendingCover(application(60000))).toMatchObject({ lendingValue: 49000, short: true })
    expect(lendingCover(application(40000))).toMatchObject({ lendingValue: 49000, short: false })
    expect(lendingCover({ data: {}, terms: { amount: 5000 } }).short).toBe(false)
  })
})

describe('underwritingStatus once the stage has passed', () => {
  it('leaves out the asset sections the workspace doesn’t ask for', () => {
    const application = { data: { collateral: { items: [vehicle] } }, valuations: {}, verifications: {} }
    expect(underwritingStatus(application, [], null, undefined).complete).toBe(false)
    expect(underwritingStatus(application, [], null, undefined, { requireValuation: false, requireLegalReview: false })).toMatchObject({ complete: true, hold: null })
  })
})
