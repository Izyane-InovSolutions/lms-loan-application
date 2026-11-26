import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

/*
 * Pre-approved loans for MoU partners' employees (src/config/partners.js): the partner's
 * staff confirm the applicant works there, then an officer issues the offer straight away.
 */

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { productDefaults } = await import('../src/config/loanProducts.js')
const { parseStaffCsv, partnerActive } = await import('../src/config/partners.js')
const { settleBackgroundTasks } = await import('../api/_lib/after.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const manager = client(handler)
const partnerUser = client(handler)
const applicant = client(handler)

const ZESCO = { name: 'Zesco Limited', mouReference: 'MOU-2026-014', mouEndsOn: '2099-12-31' }
const OTHER = { name: 'Zambia Railways', mouReference: 'MOU-2026-020', mouEndsOn: '2099-12-31' }
const product = (changes = {}) => ({
  ...productDefaults('personal'),
  name: 'Zesco Staff Loan',
  enabled: true,
  // Identity and income evidence: the partner sees the first three, never the bank statements.
  documents: productDefaults('personal').documents.filter((document) => ['nrcCopy', 'passportPhoto', 'payslips', 'bankStatements'].includes(document.slot)),
  preApproval: { enabled: true, partnerId: 'zesco-limited', maxAmount: 20000 },
  ...changes,
})

const userId = async (who) => (await who.get('/auth/me')).body.user.id
const row = async (id) => (await (await getDb()).select().from(schema.applications).where(eq(schema.applications.id, id)))[0]

let count = 0
const submit = async ({ amount = 5000, nrc = '123456/78/9' } = {}) => {
  count += 1
  const email = `staff${count}@example.com`
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo = { ...body.data.personalInfo, email, nrc }
  body.loanData = { amount, tenure: 6, productId: 'zesco-staff', income: 20000 }
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  await settleBackgroundTasks()
  return response.body.id
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await manager.post('/auth/demo', { role: 'sales_manager' })
  await partnerUser.post('/auth/demo', { role: 'partner_staff' })
  expect((await admin.put('/settings/partners', { list: [ZESCO, OTHER] })).status).toBe(200)
  const linked = await admin.patch(`/users/${await userId(partnerUser)}`, { partnerId: 'zesco-limited' })
  expect(linked.status, JSON.stringify(linked.body)).toBe(200)
})

describe('partners and pre-approved products', () => {
  it('reads a staff list from CSV, any header case, NRCs without spaces', () => {
    const { rows, errors } = parseStaffCsv('NRC,Employee Number,Name\n 123456/78/9 ,E-100,Ada Banda\nnot-an-nrc,E-1,X\n123456/78/9,E-100,Again\n"234567/89/1","E-2","Banda, Mutale"')
    expect(rows).toEqual([
      { nrc: '123456/78/9', employeeNumber: 'E-100', name: 'Ada Banda' },
      { nrc: '234567/89/1', employeeNumber: 'E-2', name: 'Banda, Mutale' },
    ])
    expect(errors).toEqual([3])
    expect(parseStaffCsv('email\nx@y.z').missingHeader).toBe(true)
    expect(partnerActive({ active: true, mouEndsOn: '2000-01-01' })).toBe(false)
  })


  it('checks partners and the product’s pre-approval', async () => {
    expect((await admin.put('/settings/partners', { list: [{ ...ZESCO, mouEndsOn: 'soon' }] })).body.message).toMatch(/date the MoU ends/)
    expect((await officer.put('/settings/partners', { list: [ZESCO] })).status).toBe(403)
    expect((await admin.put('/settings/products', { 'zesco-staff': product({ preApproval: { enabled: true, partnerId: 'nobody' } }) })).body.message).toMatch(/choose the partner/)
    expect((await admin.put('/settings/products', { 'zesco-staff': product({ preApproval: { enabled: true, partnerId: 'zesco-limited', maxAmount: 500000 } }) })).body.message).toMatch(/pre-approved limit/)
    const saved = await admin.put('/settings/products', { 'zesco-staff': product() })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.products['zesco-staff'].preApproval).toEqual({ enabled: true, partnerId: 'zesco-limited', maxAmount: 20000 })
    // A partner still named on a product can't be removed.
    expect((await admin.put('/settings/partners', { list: [OTHER] })).body.message).toMatch(/still set on the loan product/)
  })

  it('takes a staff list from admins only, replacing the last, and looks up one NRC', async () => {
    expect((await officer.post('/admin/partners/zesco-limited/staff', { csv: 'nrc\n111111/11/1' })).status).toBe(403)
    expect((await admin.post('/admin/partners/zesco-limited/staff', { csv: 'nrc\n111111/11/1\n999999/99/9' })).body.count).toBe(2)
    const uploaded = await admin.post('/admin/partners/zesco-limited/staff', { csv: 'nrc,employee_number\n123456/78/9,E-100\nbad,1' })
    expect(uploaded.body).toMatchObject({ count: 1, errors: [3], staffList: { version: 2, count: 1 } })
    expect((await admin.get('/admin/partners/zesco-limited/staff?nrc=123456/78/9')).body).toEqual({ found: true, employeeNumber: 'E-100', name: null })
    // The earlier list is gone.
    expect((await admin.get('/admin/partners/zesco-limited/staff?nrc=111111/11/1')).body.found).toBe(false)
    const partners = (await admin.get('/settings')).body.settings.partners.list
    expect(partners[0].staffList).toMatchObject({ version: 2, count: 1, uploadedByName: expect.any(String) })
  })

  it('shows admins the current staff list a page at a time, searchable, and audits each look', async () => {
    const csv = ['nrc,employee_number,name', ...Array.from({ length: 30 }, (_, i) => `${String(200000 + i)}/11/1,E-${i},Person ${i}`), '123456/78/9,E-100,Ada Banda'].join('\n')
    await admin.post('/admin/partners/zesco-limited/staff', { csv })
    expect((await officer.get('/admin/partners/zesco-limited/staff/people')).status).toBe(403)
    expect((await admin.get('/admin/partners/no-such/staff/people')).status).toBe(404)
    const first = (await admin.get('/admin/partners/zesco-limited/staff/people?pageSize=25')).body
    expect(first).toMatchObject({ total: 31, page: 1, pageSize: 25 })
    expect(first.people).toHaveLength(25)
    expect(Object.keys(first.people[0]).sort()).toEqual(['employeeNumber', 'id', 'name', 'nrc'])
    expect((await admin.get('/admin/partners/zesco-limited/staff/people?pageSize=25&page=2')).body.people).toHaveLength(6)
    // By name, employee number or NRC.
    expect((await admin.get('/admin/partners/zesco-limited/staff/people?q=ada')).body.people).toMatchObject([{ nrc: '123456/78/9', employeeNumber: 'E-100', name: 'Ada Banda' }])
    expect((await admin.get('/admin/partners/zesco-limited/staff/people?q=E-100')).body.total).toBe(1)
    expect((await admin.get('/admin/partners/zesco-limited/staff/people?q=123456/78')).body.total).toBe(1)
    const audit = (await admin.get('/audit?action=partner.staff_list_viewed')).body
    expect(JSON.stringify(audit)).not.toContain('123456/78/9')
    // Back to the one-person list the next tests expect.
    await admin.post('/admin/partners/zesco-limited/staff', { csv: 'nrc,employee_number\n123456/78/9,E-100' })
  })

  it('lets admins add, edit and remove one person by hand, keeping the count', async () => {
    const people = '/admin/partners/zesco-limited/staff/people'
    const count = async () => (await admin.get('/settings')).body.settings.partners.list.find((partner) => partner.id === 'zesco-limited').staffList.count
    expect((await officer.post(people, { nrc: '333333/33/3' })).status).toBe(403)
    expect((await admin.post(people, { nrc: 'not-an-nrc' })).body.code).toBe('invalid_nrc')
    expect((await admin.post(people, { nrc: '123456/78/9' })).body.code).toBe('already_listed')

    const added = await admin.post(people, { nrc: ' 333333/33/3 ', employeeNumber: 'E-333', name: 'Chanda Mwale' })
    expect(added.status, JSON.stringify(added.body)).toBe(200)
    expect(added.body.person).toMatchObject({ id: expect.any(String), nrc: '333333/33/3', employeeNumber: 'E-333', name: 'Chanda Mwale' })
    expect(await count()).toBe(2)
    // The applicant check sees them straight away.
    expect((await admin.get('/admin/partners/zesco-limited/staff?nrc=333333/33/3')).body).toMatchObject({ found: true, employeeNumber: 'E-333' })

    const { id } = added.body.person
    expect((await admin.patch(`${people}/${id}`, { nrc: '123456/78/9' })).body.code).toBe('already_listed')
    const edited = await admin.patch(`${people}/${id}`, { nrc: '333333/33/4', employeeNumber: '', name: 'Chanda M. Mwale' })
    expect(edited.body.person).toMatchObject({ nrc: '333333/33/4', employeeNumber: null, name: 'Chanda M. Mwale' })
    expect((await admin.get('/admin/partners/zesco-limited/staff?nrc=333333/33/3')).body.found).toBe(false)

    expect((await admin.del(`${people}/${id}`)).status).toBe(200)
    expect((await admin.del(`${people}/${id}`)).status).toBe(404)
    expect(await count()).toBe(1)
    expect((await admin.get(`${people}`)).body.people.map((person) => person.nrc)).toEqual(['123456/78/9'])
  })
})

describe('the pre-approval route', () => {
  let caseId

  it('sends a submitted application to the partner, with the staff-list match', async () => {
    caseId = await submit()
    const application = await row(caseId)
    expect(application.state).toBe('submitted')
    expect(application.preApproval).toMatchObject({ partnerId: 'zesco-limited', partnerName: 'Zesco Limited', stage: 'partner', staffMatch: { onList: true, employeeNumber: 'E-100' } })
  })

  it('sends amounts above the limit to the partner too, then to the usual review once confirmed', async () => {
    const overId = await submit({ amount: 25000 })
    const over = await row(overId)
    expect(over.preApproval).toMatchObject({ stage: 'partner', overLimit: expect.stringMatching(/above the pre-approved limit of K20,000/) })
    const pending = (await partnerUser.get('/partner/requests')).body.requests.find((request) => request.id === overId)
    // The partner sees why it won't be fast-tracked.
    expect(pending.overLimit).toMatch(/above the pre-approved limit of K20,000/)
    expect((await partnerUser.get(`/partner/requests/${overId}`)).body.request.overLimit).toMatch(/K25,000 was asked for/)
    // Held for the partner like any other.
    const early = await manager.post(`/applications/${overId}/actions`, { action: 'issue_offer', version: over.version })
    expect(early.status).toBe(409)

    const confirmed = await partnerUser.post(`/partner/requests/${overId}`, { decision: 'confirm', version: over.version })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    const after = await row(overId)
    // Confirmed, but never fast-tracked to an offer: it goes through the usual review.
    expect(after.preApproval).toMatchObject({ stage: 'review', partnerDecision: { confirmed: true }, reason: expect.stringMatching(/above the pre-approved limit/) })
    expect((await partnerUser.get('/partner/requests?view=recent')).body.requests.map((request) => request.id)).toContain(overId)
  })

  it('shows the partner’s staff only their own partner’s applicants, and no case pages', async () => {
    const { requests } = (await partnerUser.get('/partner/requests')).body
    expect(requests.map((request) => request.id)).toContain(caseId)
    expect(requests.every((request) => request.partnerId === 'zesco-limited')).toBe(true)
    expect(Object.keys(requests[0]).sort()).toEqual(
      ['amount', 'applicantName', 'employerName', 'id', 'monthlyInstalment', 'nrc', 'overLimit', 'partnerDecision', 'partnerId', 'partnerName', 'passportNumber', 'reference', 'stage', 'staffMatch', 'submittedAt', 'tenure', 'version'].sort()
    )
    expect((await partnerUser.get(`/applications/${caseId}`)).status).toBe(404)
    expect((await partnerUser.get('/applications')).body.applications || []).toEqual([])
    // Someone at another partner sees none of them, and can't answer them.
    const id = await userId(partnerUser)
    await admin.patch(`/users/${id}`, { partnerId: 'zambia-railways' })
    expect((await partnerUser.get('/partner/requests')).body.requests).toEqual([])
    expect((await partnerUser.post(`/partner/requests/${caseId}`, { decision: 'confirm', version: (await row(caseId)).version })).status).toBe(404)
    await admin.patch(`/users/${id}`, { partnerId: 'zesco-limited' })
    expect((await officer.get('/partner/requests')).status).toBe(403)
  })

  it('holds the offer until the partner confirms', async () => {
    const { version } = await row(caseId)
    const early = await manager.post(`/applications/${caseId}/actions`, { action: 'issue_offer', version })
    expect(early.status).toBe(409)
    expect(early.body.message).toMatch(/Waiting for Zesco Limited/)
  })

  it('needs a reason to refuse, and confirming makes it ready to issue', async () => {
    const { version } = await row(caseId)
    expect((await partnerUser.post(`/partner/requests/${caseId}`, { decision: 'refuse', version })).body.code).toBe('note_required')
    const confirmed = await partnerUser.post(`/partner/requests/${caseId}`, { decision: 'confirm', note: 'Permanent staff', version })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.request).toMatchObject({ stage: 'issue', partnerDecision: { confirmed: true, employeeNumber: 'E-100' } })
    expect((await partnerUser.post(`/partner/requests/${caseId}`, { decision: 'confirm', version: version + 1 })).status).toBe(409)
    expect((await partnerUser.get('/partner/requests?view=recent')).body.requests[0].id).toBe(caseId)
  })

  it('lets an officer issue the offer straight away, within the pre-approved limit', async () => {
    const detail = (await officer.get(`/applications/${caseId}`)).body
    expect(detail.workflow.preApproval).toMatchObject({ stage: 'issue', maxAmount: 20000 })
    expect(detail.workflow.preApproval.issueBlocked).toBeNull()
    const { version } = detail.application
    expect((await officer.post(`/applications/${caseId}/actions`, { action: 'issue_offer', amount: 25000, version })).body.message).toMatch(/K20,000|between/)
    const issued = await officer.post(`/applications/${caseId}/actions`, { action: 'issue_offer', amount: 4000, version })
    expect(issued.status, JSON.stringify(issued.body)).toBe(200)
    const application = await row(caseId)
    expect(application).toMatchObject({ state: 'approved', status: 'approved', approvedAmount: 4000, approvedTenure: 6 })
    expect(application.offerExpiresAt).toBeTruthy()
    expect(application.preApproval).toMatchObject({ stage: 'issued', issued: { byName: expect.any(String) } })
    const db = await getDb()
    const [decision] = await db.select().from(schema.appraisals).where(eq(schema.appraisals.applicationId, caseId))
    expect(decision).toMatchObject({ kind: 'decision', verdict: 'approve', amount: 4000 })
    expect(decision.rationale).toMatch(/Pre-approved under the Zesco Limited MoU \(MOU-2026-014\)/)
    // Issued once only.
    expect((await officer.post(`/applications/${caseId}/actions`, { action: 'issue_offer', version: application.version })).status).toBe(409)
  })

  it('goes to the usual review when the partner refuses, an officer sends it, or the review starts', async () => {
    const refused = await submit()
    await partnerUser.post(`/partner/requests/${refused}`, { decision: 'refuse', note: 'Left the company in June', version: (await row(refused)).version })
    expect((await row(refused)).preApproval).toMatchObject({ stage: 'review', reason: 'Zesco Limited did not confirm employment: Left the company in June' })

    // While it waits for the partner, only a system administrator takes it off the route.
    const sent = await submit()
    const noReason = await admin.post(`/applications/${sent}/actions`, { action: 'leave_pre_approval', version: (await row(sent)).version })
    expect(noReason.status).toBe(400)
    await admin.post(`/applications/${sent}/actions`, { action: 'leave_pre_approval', rationale: 'Large existing deductions', version: (await row(sent)).version })
    expect((await row(sent)).preApproval).toMatchObject({ stage: 'review', reason: 'Large existing deductions' })

    const started = await submit()
    const review = await admin.post(`/applications/${started}/actions`, { action: 'start_review', version: (await row(started)).version })
    expect(review.status, JSON.stringify(review.body)).toBe(200)
    const after = await row(started)
    expect(after.state).not.toBe('submitted')
    expect(after.preApproval.stage).toBe('review')
    expect((await partnerUser.get('/partner/requests')).body.requests.map((request) => request.id)).not.toContain(started)
  })

  it('holds the case for the partner: no one else validates or reviews it, but a system administrator', async () => {
    const id = await submit()
    const { version } = await row(id)
    for (const action of [{ action: 'start_review' }, { action: 'leave_pre_approval', rationale: 'Large existing deductions' }, { action: 'request_info', message: 'Send a newer payslip please' }]) {
      const refused = await officer.post(`/applications/${id}/actions`, { ...action, version })
      expect(refused.status, action.action).toBe(409)
      expect(refused.body).toMatchObject({ code: 'held_for_partner', message: expect.stringMatching(/only their staff or a system administrator/) })
    }
    expect((await officer.post(`/applications/${id}/figures`, { netPay: 9000 })).body.code).toBe('held_for_partner')
    expect((await officer.post(`/applications/${id}/prescreen`, {})).body.code).toBe('held_for_partner')
    // Read-only, with notes.
    expect((await officer.get(`/applications/${id}`)).status).toBe(200)
    expect((await officer.post(`/applications/${id}/actions`, { action: 'note', message: 'Customer called to ask', version })).status).toBe(200)

    // Held from the moment it is submitted, while it is pre-screened.
    await (await getDb()).update(schema.applications).set({ preApproval: { ...(await row(id)).preApproval, stage: 'prescreen' } }).where(eq(schema.applications.id, id))
    const early = await officer.post(`/applications/${id}/actions`, { action: 'start_review', version: (await row(id)).version })
    expect(early.body).toMatchObject({ code: 'held_for_partner', message: expect.stringMatching(/still being pre-screened/) })
    expect((await partnerUser.get('/partner/requests')).body.requests.map((request) => request.id)).not.toContain(id)

    const byAdmin = await admin.post(`/applications/${id}/actions`, { action: 'start_review', version: (await row(id)).version })
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200)
    // Released once off the route.
    expect((await officer.post(`/applications/${id}/actions`, { action: 'note', message: 'Picked up', version: (await row(id)).version })).status).toBe(200)
  })

  it('starts held as it is submitted, and tells the applicant their details go to the partner', async () => {
    const id = await submit()
    const { consents } = (await officer.get(`/applications/${id}`)).body
    expect(consents.find((consent) => consent.type === 'partner_notice')).toMatchObject({ granted: true, noticeVersion: 'partner-notice-2026-11' })
    const events = (await officer.get(`/applications/${id}`)).body.events.map((event) => event.message)
    expect(events.some((message) => /sent to Zesco Limited to confirm employment/.test(message))).toBe(true)
  })

  it('lets the partner review the person and their ID and payslips, nothing else, while it waits for them', async () => {
    const id = await submit()
    const response = await partnerUser.get(`/partner/requests/${id}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const { request } = response.body
    expect(request.applicant).toEqual({ firstName: 'Ada', middleName: null, surname: 'Banda', nationality: 'Zambia', birthDate: '1990-05-01', phone: '971234567', occupation: expect.any(String), employerName: expect.any(String) })
    expect(request).toMatchObject({ nrc: '123456/78/9', staffMatch: { onList: true } })
    expect(request.documents.map((document) => document.slot).sort()).toEqual(['nrcCopy', 'passportPhoto', 'payslips'])
    const file = await partnerUser.get(`/partner/requests/${id}/documents/${request.documents[0].id}`)
    expect(file.status).toBe(200)

    // Not the bank statements, nor another case's files.
    const db = await getDb()
    const others = (await db.select().from(schema.applicationDocuments).where(eq(schema.applicationDocuments.applicationId, id))).filter((document) => !['nrcCopy', 'passportPhoto', 'payslips'].includes(document.slot))
    expect(others.map((document) => document.slot)).toContain('bankStatements')
    for (const document of others) expect((await partnerUser.get(`/partner/requests/${id}/documents/${document.id}`)).status).toBe(404)
    expect((await officer.get(`/partner/requests/${id}`)).status).toBe(403)

    // Another partner's staff, and the partner once they've answered, see nothing.
    const me = await userId(partnerUser)
    await admin.patch(`/users/${me}`, { partnerId: 'zambia-railways' })
    expect((await partnerUser.get(`/partner/requests/${id}`)).status).toBe(404)
    await admin.patch(`/users/${me}`, { partnerId: 'zesco-limited' })
    await partnerUser.post(`/partner/requests/${id}`, { decision: 'confirm', version: (await row(id)).version })
    expect((await partnerUser.get(`/partner/requests/${id}`)).status).toBe(404)
    expect((await partnerUser.get(`/partner/requests/${id}/documents/${request.documents[0].id}`)).status).toBe(404)
  })

  it('never shows a passport holder’s leftover NRC, nor matches the staff list by it', async () => {
    count += 1
    const email = `staff${count}@example.com`
    const { token, body } = await prepareDraft(email)
    body.data.personalInfo = { ...body.data.personalInfo, email, nrc: '123456/78/9', passportNumber: 'AK1234567' }
    body.data.employmentInfo = { ...body.data.employmentInfo, nationality: 'Kenya' }
    // A passport copy in place of the NRC copy.
    const draft = await kv.get(`draft:${email}`)
    draft.documents['personal.documents.passportCopy'] = { ...draft.documents['personal.documents.nrcCopy'], filename: 'passportCopy.pdf' }
    await kv.set(`draft:${email}`, draft)
    body.data.documents = { ...body.data.documents, passportCopy: { __draftFile__: 'personal.documents.passportCopy' } }
    body.loanData = { amount: 5000, tenure: 6, productId: 'zesco-staff', income: 20000 }
    const submitted = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    await settleBackgroundTasks()
    const { request } = (await partnerUser.get(`/partner/requests/${submitted.body.id}`)).body
    expect(request).toMatchObject({ nrc: null, passportNumber: 'AK1234567', staffMatch: { onList: false }, applicant: { nationality: 'Kenya' } })
    expect(request.documents.map((document) => document.slot)).toContain('passportCopy')
  })

  it('never lets someone issue the offer on a case they brought in', async () => {
    const id = await submit()
    await partnerUser.post(`/partner/requests/${id}`, { decision: 'confirm', version: (await row(id)).version })
    await (await getDb()).update(schema.applications).set({ sourcedBy: await userId(manager) }).where(eq(schema.applications.id, id))
    const response = await manager.post(`/applications/${id}/actions`, { action: 'issue_offer', version: (await row(id)).version })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('four_eyes')
  })

  it('stops sending new cases to a partner whose MoU has ended', async () => {
    await admin.put('/settings/partners', { list: [{ ...ZESCO, id: 'zesco-limited', mouEndsOn: '2020-01-01' }, OTHER] })
    const lapsed = await row(await submit())
    expect(lapsed.preApproval).toMatchObject({ stage: 'review', reason: 'The Zesco Limited MoU has ended.' })
    await admin.put('/settings/partners', { list: [{ ...ZESCO, id: 'zesco-limited' }, OTHER] })
  })

  it('needs a partner for partner staff', async () => {
    const response = await admin.patch(`/users/${await userId(partnerUser)}`, { partnerId: null })
    expect(response.body.code).toBe('invalid_partner')
  })
})
