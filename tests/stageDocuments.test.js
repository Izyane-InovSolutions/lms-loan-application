import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer, emailCode, signaturePng, signedAcceptance } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// Every email, as the mail server would get it (the test one does not exist).
const sent = []
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message)
        return { messageId: String(sent.length) }
      },
    }),
  },
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { saveDraftWorkflow, publishDraftWorkflow } = await import('../api/_lib/workflowVersions.js')
const { validateWorkflow, legacyToWorkflow, stateDocuments } = await import('../src/config/workflow.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)

const waitFor = async (check, attempts = 80) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting')
}

const caseOf = async (id) => (await admin.get(`/applications/${id}`)).body
const act = async (who, id, action, extra = {}) => who.post(`/applications/${id}/actions`, { action, version: (await caseOf(id)).application.version, ...extra })
const move = (who, id, actionId, extra = {}) => act(who, id, 'transition', { actionId, ...extra })

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body
}

const customerFor = async (email) => {
  const customer = client(handler)
  await emailCode(kv, 'login', email, '101010')
  await customer.post('/auth/customer', { email, code: '101010' })
  return customer
}

const signature = (name = 'Ada Banda') => ({ name, method: 'drawn', image: `data:image/png;base64,${signaturePng().toString('base64')}` })

// Prescreening sends a mandate to sign (required to move on) and a form to keep.
const FLOW = {
  start: 'intake',
  checklist: [{ key: 'identity', label: 'Identity verified', requiredToApprove: true }],
  states: [
    { id: 'intake', label: 'Intake', type: 'work', actions: [{ id: 'prescreen', label: 'Send to prescreening', kind: 'move', to: 'prescreening', options: { claim: true } }] },
    {
      id: 'prescreening',
      label: 'Prescreening',
      type: 'work',
      documents: [
        { kind: 'debit_order_mandate', required: true },
        { kind: 'key_facts', required: false },
      ],
      actions: [
        { id: 'underwrite', label: 'Send to underwriting', kind: 'recommend', to: 'underwriting', options: { checks: ['identity'] } },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    {
      id: 'underwriting',
      label: 'Underwriting',
      type: 'work',
      actions: [
        { id: 'approve', label: 'Approve', kind: 'approve', to: 'offer' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    { id: 'offer', label: 'Offer', type: 'offer', offer: { onAccept: 'disbursement' }, actions: [] },
    { id: 'disbursement', label: 'Disbursement', type: 'work', actions: [{ id: 'pay', label: 'Mark as paid out', kind: 'pay_out', to: 'paid_out' }] },
    { id: 'paid_out', label: 'Paid out', type: 'final', actions: [] },
    { id: 'declined', label: 'Declined', type: 'final', actions: [] },
    { id: 'withdrawn', label: 'Withdrawn', type: 'final', actions: [] },
    { id: 'expired', label: 'Offer expired', type: 'final', actions: [] },
  ],
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('the offer, on a workflow from before stage documents', () => {
  it('emails the offer letter on approval, signed by accepting, then the facility letter to sign on its own', async () => {
    const email = 'legacy-offer@example.com'
    const { id, reference } = await submit(email)
    await act(officer, id, 'start_review')
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect((await act(admin, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })).body.application.status).toBe('approved')

    // The offer: the offer letter alone.
    const offerEmail = await waitFor(() => sent.find((entry) => entry.subject === `Documents to sign for ${reference}`))
    expect(offerEmail.attachments).toHaveLength(1)
    const issued = await waitFor(async () => {
      const { stageDocuments: documents } = await caseOf(id)
      return documents.length === 1 && documents[0].status === 'sent' && documents
    })
    expect(issued.map((document) => [document.kind, document.offer, document.required])).toEqual([['offer_letter', true, false]])
    expect((await caseOf(id)).documents.filter((document) => document.source === 'system')).toHaveLength(1)

    const customer = await customerFor(email)
    // It's signed with the offer, not on its own.
    const before = (await customer.get(`/me/applications/${id}`)).body
    expect(before.stageDocuments).toEqual([])
    expect(before.offerDocuments.map((document) => document.kind)).toEqual(['offer_letter'])
    const accepted = await customer.post(`/me/applications/${id}/accept`, await signedAcceptance(kv, email))
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)

    // Accepted: the facility letter goes out by itself, for the customer to sign.
    const facilityEmail = await waitFor(() => sent.filter((entry) => entry.subject === `Documents to sign for ${reference}`)[1])
    expect(facilityEmail.attachments).toHaveLength(1)
    const facility = await waitFor(async () => (await customer.get(`/me/applications/${id}`)).body.stageDocuments.find((document) => document.kind === 'loan_agreement'))
    expect(facility).toMatchObject({ label: 'Facility letter', status: 'sent' })
    const { code, signature } = await signedAcceptance(kv, email)
    expect((await customer.post(`/me/applications/${id}/stage-documents/${facility.id}/sign`, { agreed: true, code, signature })).status).toBe(200)
    expect((await caseOf(id)).stageDocuments.map((document) => [document.kind, document.status])).toEqual([
      ['offer_letter', 'signed'],
      ['loan_agreement', 'signed'],
    ])
  })
})

describe('custom document kinds', () => {
  it('are added in Settings → Documents, with a key made from the name', async () => {
    expect((await officer.put('/settings/documents', { kinds: [{ label: 'Debit order mandate' }] })).status).toBe(403)
    const saved = await admin.put('/settings/documents', {
      kinds: [
        { label: 'Debit order mandate', requiresSignature: true },
        { key: 'key_facts', label: 'Key facts', requiresSignature: false },
        { label: 'Unused form', requiresSignature: true },
      ],
    })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.documents.kinds.map((kind) => kind.key)).toEqual(['debit_order_mandate', 'key_facts', 'unused_form'])
  })

  it('refuses a name already taken, or removing one', async () => {
    const { kinds } = (await admin.get('/settings')).body.settings.documents
    expect((await admin.put('/settings/documents', { kinds: [...kinds, { label: 'Facility letter' }] })).body.message).toMatch(/already a document called/)
    expect((await admin.put('/settings/documents', { kinds: [...kinds, { label: 'key facts' }] })).status).toBe(400)
    expect((await admin.put('/settings/documents', { kinds: kinds.slice(1) })).body.message).toMatch(/Retire it instead/)
  })

  it('get starter wording, with a place to sign when they need a signature', async () => {
    const { body } = await admin.get('/admin/templates')
    expect(body.kindList.map((kind) => kind.key)).toEqual(['offer_letter', 'loan_agreement', 'debit_order_mandate', 'key_facts', 'unused_form'])
    const mandate = body.kinds.debit_order_mandate.published
    expect(mandate).toMatchObject({ version: 1, title: 'Debit order mandate', placeholder: true, unknownPlaceholders: [] })
    expect(mandate.body).toContain('{{customer_signature}}')
    expect(body.kinds.key_facts.published.body).not.toContain('{{customer_signature}}')
    const preview = await admin.get('/admin/templates/debit_order_mandate/preview')
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF')
    expect((await admin.get('/admin/templates/no_such_kind/preview')).status).toBe(404)
  })
})

describe('documents in the workflow', () => {
  const kinds = [
    { key: 'offer_letter', label: 'Offer letter' },
    { key: 'loan_agreement', label: 'Facility letter' },
    { key: 'debit_order_mandate', label: 'Debit order mandate' },
    { key: 'key_facts', label: 'Key facts' },
    { key: 'old_form', label: 'Old form', retired: true },
  ]
  const withDocuments = (stateId, documents) => ({ ...FLOW, states: FLOW.states.map((state) => (state.id === stateId ? { ...state, documents } : state)) })
  const errorsOf = (definition) => validateWorkflow(definition, { documentKinds: kinds }).errors.map((error) => error.message).join('\n')

  it('accept known kinds, once each', () => {
    expect(errorsOf(withDocuments('prescreening', [{ kind: 'debit_order_mandate', required: true }]))).toBe('')
    expect(errorsOf(withDocuments('prescreening', [{ kind: 'nothing_here' }]))).toMatch(/document that no longer exists/)
    expect(errorsOf(withDocuments('prescreening', [{ kind: 'old_form' }]))).toMatch(/which is retired/)
    expect(errorsOf(withDocuments('prescreening', [{ kind: 'debit_order_mandate' }, { kind: 'debit_order_mandate' }]))).toMatch(/twice/)
    expect(errorsOf(withDocuments('declined', [{ kind: 'debit_order_mandate' }]))).toMatch(/is an end: it can’t send documents/)
  })

  it('send the offer documents only once the loan is approved', () => {
    expect(errorsOf(withDocuments('prescreening', [{ kind: 'loan_agreement' }]))).toMatch(/only be sent from the offer or after it/)
    expect(errorsOf(withDocuments('disbursement', [{ kind: 'loan_agreement', required: true }]))).toBe('')
  })

  it('keep the offer letter on an offer state without a list, and the facility letter after acceptance', () => {
    const definition = legacyToWorkflow()
    const offer = definition.states.find((state) => state.type === 'offer')
    expect(stateDocuments(offer, definition)).toEqual([{ kind: 'offer_letter', required: false }])
    expect(stateDocuments({ ...offer, documents: [] }, definition)).toEqual([])
    const afterAcceptance = definition.states.find((state) => state.id === offer.offer.onAccept)
    expect(stateDocuments(afterAcceptance, definition)).toEqual([{ kind: 'loan_agreement', required: false }])
    // A list of its own replaces the default.
    expect(stateDocuments({ ...afterAcceptance, documents: [{ kind: 'loan_agreement', required: true }] }, definition)).toEqual([{ kind: 'loan_agreement', required: true }])
  })

  it('can’t retire a kind the workflow sends', async () => {
    await saveDraftWorkflow(FLOW, 'Stage documents', { id: null })
    await publishDraftWorkflow({ id: null }, 'Stage documents')
    const { kinds: stored } = (await admin.get('/settings')).body.settings.documents
    const retire = (key) => stored.map((kind) => (kind.key === key ? { ...kind, retired: true } : kind))
    expect((await admin.put('/settings/documents', { kinds: retire('debit_order_mandate') })).body.message).toMatch(/is sent at “Prescreening”/)
    expect((await admin.put('/settings/documents', { kinds: retire('unused_form') })).status).toBe(200)
    const editor = (await admin.get('/admin/workflow')).body
    expect(editor.documentKinds.find((kind) => kind.key === 'unused_form')).toMatchObject({ retired: true })
  })
})

describe('a stage that sends documents', () => {
  let id
  let reference
  let customer
  const email = 'stage-docs@example.com'

  it('makes them on entering the stage and emails them in one go, attached', async () => {
    const submitted = await submit(email)
    id = submitted.id
    reference = submitted.reference
    sent.length = 0
    expect((await move(officer, id, 'prescreen')).status).toBe(200)
    const message = await waitFor(() => sent.find((entry) => entry.subject === `Documents to sign for ${reference}`))
    expect(message.to).toBe(email)
    expect(message.attachments.map((attachment) => attachment.filename)).toEqual([`debit-order-mandate-${reference}.pdf`, `key-facts-${reference}.pdf`])
    expect(message.attachments.every((attachment) => attachment.content.subarray(0, 4).toString() === '%PDF')).toBe(true)
    expect(message.html).toContain('/my-applications')

    const body = await waitFor(async () => {
      const current = await caseOf(id)
      return current.stageDocuments.every((document) => document.status === 'sent') && current
    })
    expect(body.stageDocuments.map(({ kind, required, requiresSignature, stage }) => ({ kind, required, requiresSignature, stage }))).toEqual([
      { kind: 'debit_order_mandate', required: true, requiresSignature: true, stage: 'prescreening' },
      { kind: 'key_facts', required: false, requiresSignature: false, stage: 'prescreening' },
    ])
    expect(body.events.some((event) => event.message === 'Sent to the applicant to sign: Debit order mandate, Key facts' && event.visibleToCustomer)).toBe(true)
  })

  it('holds the case until the required one is signed', async () => {
    await act(officer, id, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    const held = await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })
    expect(held.status).toBe(409)
    expect(held.body).toMatchObject({ code: 'documents_outstanding' })
    expect(held.body.message).toContain('Debit order mandate')
    const { workflow } = await caseOf(id)
    expect(workflow.state.documentsOutstanding).toEqual(['Debit order mandate'])
    // Turning the case down is never held.
    expect(workflow.actions.find((action) => action.id === 'reject').blocked).toBeNull()
  })

  it('shows the applicant their documents, and notes when they open one', async () => {
    customer = await customerFor(email)
    const { body } = await customer.get(`/me/applications/${id}`)
    expect(body.stageDocuments.map((document) => [document.label, document.status])).toEqual([
      ['Debit order mandate', 'sent'],
      ['Key facts', 'sent'],
    ])
    const file = await customer.get(`/applications/${id}/documents/${body.stageDocuments[0].id}`)
    expect(file.status).toBe(200)
    expect((await caseOf(id)).stageDocuments[0].status).toBe('viewed')
  })

  it('lets the applicant sign one online, with the emailed code', async () => {
    const [mandate, facts] = (await customer.get(`/me/applications/${id}`)).body.stageDocuments
    await emailCode(kv, 'sign', email, '424242')
    expect((await customer.post(`/me/applications/${id}/stage-documents/${mandate.id}/sign`, { agreed: true, code: '000000', signature: signature() })).body.code).toBe('invalid_code')
    expect((await customer.post(`/me/applications/${id}/stage-documents/${facts.id}/sign`, { agreed: true, code: '424242', signature: signature() })).status).toBe(409)
    const signed = await customer.post(`/me/applications/${id}/stage-documents/${mandate.id}/sign`, { agreed: true, code: '424242', signature: signature('Ada T. Banda') })
    expect(signed.status, JSON.stringify(signed.body)).toBe(200)

    const body = await caseOf(id)
    const document = body.stageDocuments.find((entry) => entry.kind === 'debit_order_mandate')
    expect(document).toMatchObject({ status: 'signed', done: true })
    const [record] = body.signatures
    expect(record).toMatchObject({ signerName: 'Ada T. Banda', sealValid: true })
    expect(record.documents).toMatchObject([{ kind: 'debit_order_mandate', documentId: mandate.id, signedDocumentId: document.signedDocumentId }])
    expect((await customer.get(`/applications/${id}/documents/${document.signedDocumentId}`)).status).toBe(200)
    // Signed once is enough.
    await emailCode(kv, 'sign', email, '434343')
    expect((await customer.post(`/me/applications/${id}/stage-documents/${mandate.id}/sign`, { agreed: true, code: '434343', signature: signature() })).body.code).toBe('already_done')
  })

  it('sends again only what isn’t done, and then lets the case move on', async () => {
    sent.length = 0
    expect((await officer.post(`/applications/${id}/stage-documents/send`, {})).status).toBe(200)
    expect(sent.at(-1)).toMatchObject({ subject: `Documents for ${reference}` })
    expect(sent.at(-1).attachments.map((attachment) => attachment.filename)).toEqual([`key-facts-${reference}.pdf`])
    const moved = await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
  })
})

describe('a signed copy uploaded instead', () => {
  it('waits for staff to check it, then lets the case move on', async () => {
    const email = 'wet-ink@example.com'
    const { id } = await submit(email)
    await move(officer, id, 'prescreen')
    await act(officer, id, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    const customer = await customerFor(email)
    const mandate = await waitFor(async () => (await customer.get(`/me/applications/${id}`)).body.stageDocuments?.find((document) => document.kind === 'debit_order_mandate'))

    const html = await customer.upload(`/me/applications/${id}/stage-documents/${mandate.id}/upload`, { filename: 'signed.html', contentType: 'text/html', data: Buffer.from('<html><body>signed</body></html>') })
    expect(html.status).toBe(400)
    const uploaded = await customer.upload(`/me/applications/${id}/stage-documents/${mandate.id}/upload`, { filename: 'signed-mandate.png', contentType: 'image/png', data: signaturePng() })
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200)

    let body = await caseOf(id)
    const document = body.stageDocuments.find((entry) => entry.kind === 'debit_order_mandate')
    expect(document).toMatchObject({ status: 'uploaded', done: false, uploadedDocumentId: expect.any(String) })
    expect(body.documents.find((entry) => entry.id === document.uploadedDocumentId)).toMatchObject({ source: 'signed_copy', label: 'Debit order mandate (signed copy)' })
    // An upload alone doesn't release the case: someone checks it first.
    expect((await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })).body.code).toBe('documents_outstanding')

    const received = await officer.post(`/applications/${id}/stage-documents/${document.id}/received`, { note: 'Signature matches the NRC' })
    expect(received.status, JSON.stringify(received.body)).toBe(200)
    body = received.body
    expect(body.stageDocuments.find((entry) => entry.id === document.id)).toMatchObject({ status: 'received', done: true, receivedByName: expect.any(String), receivedNote: 'Signature matches the NRC' })
    expect(body.events.some((event) => event.message.startsWith('Debit order mandate received (the uploaded copy checked)'))).toBe(true)
    expect((await officer.post(`/applications/${id}/stage-documents/${document.id}/received`, {})).body.code).toBe('already_done')
    // The applicant can't act on it any more.
    expect((await customer.upload(`/me/applications/${id}/stage-documents/${mandate.id}/upload`, { filename: 'again.png', contentType: 'image/png', data: signaturePng() })).body.code).toBe('already_done')

    expect((await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })).status).toBe(200)
  })
})
