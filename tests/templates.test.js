import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { saveTemplateDraft } = await import('../api/_lib/templates.js')
const { sha256 } = await import('../api/_lib/pdf.js')

const prepareDraft = draftPreparer(kv, putBlob)

const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)

const waitFor = async (check, attempts = 60) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting')
}

const act = async (who, id, action, extra = {}) => {
  const { version } = (await admin.get(`/applications/${id}`)).body.application
  const response = await who.post(`/applications/${id}/actions`, { action, version, ...extra })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body
}

/** Submits and approves a loan through the real workflow; returns its id. */
const approvedLoan = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const { body: submitted } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  await act(officer, submitted.id, 'start_review')
  for (const check of ['identity', 'documents', 'income']) await act(officer, submitted.id, 'check', { check, done: true, note: 'Seen' })
  await act(officer, submitted.id, 'recommend', { verdict: 'approve', rationale: 'Affordable', amount: 4500, conditions: 'Employer confirms payroll deduction.' })
  await act(admin, submitted.id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
  return submitted.id
}

/** A lender's own PDF with form fields. */
const lenderPdf = async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const form = doc.getForm()
  ;['{{customer_name}}', 'Amount', 'customer_signature'].forEach((name, index) => form.createTextField(name).addToPage(page, { x: 50, y: 700 - index * 80, width: 250, height: 40 }))
  return Buffer.from(await doc.save())
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('templates in the workspace', () => {
  it('start with placeholder wording, published as version 1', async () => {
    const { body } = await admin.get('/admin/templates')
    expect(body.kinds.offer_letter.published).toMatchObject({ version: 1, source: 'text', placeholder: true })
    expect(body.kinds.loan_agreement.published.version).toBe(1)
    expect(body.fields.map((field) => field.key)).toContain('monthly_instalment')
    expect((await officer.get('/admin/templates')).status).toBe(403)
  })

  it('saves a written draft, flags unknown fields, previews it and publishes it', async () => {
    const saved = await admin.put('/admin/templates/offer_letter/draft', {
      title: 'Our offer to {{customer_name}}',
      body: 'Dear {{customer_name}},\n\nWe offer {{amount}} over {{tenure}}. {{signature_date}}\n\n## Conditions\n{{conditions}}',
    })
    expect(saved.body.draft.unknownPlaceholders).toEqual(['signature_date'])

    const preview = await admin.get('/admin/templates/offer_letter/preview?version=draft')
    expect(preview.headers['content-type']).toBe('application/pdf')
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF')

    const published = await admin.post('/admin/templates/offer_letter/publish', {})
    expect(published.body.published).toMatchObject({ version: 2, placeholder: false })
    const { body } = await admin.get('/admin/templates')
    expect(body.kinds.offer_letter.draft).toBeNull()
    expect(body.kinds.offer_letter.history.map((entry) => [entry.version, entry.status])).toEqual([[2, 'published'], [1, 'retired']])
  })

  it('reports which fields of an uploaded PDF it will fill', async () => {
    const data = await lenderPdf()
    const stored = await putBlob('templates/loan_agreement/test-agreement.pdf', data, { contentType: 'application/pdf' })
    await saveTemplateDraft('loan_agreement', { source: 'pdf', title: 'Our agreement', pdfPathname: stored.pathname, pdfUrl: stored.url, pdfFilename: 'agreement.pdf', fields: ['{{customer_name}}', 'Amount', 'customer_signature'] })
    const { body } = await admin.get('/admin/templates')
    expect(body.kinds.loan_agreement.draft).toMatchObject({ source: 'pdf', hasSignatureField: true, otherFields: [] })
    expect((await admin.post('/admin/templates/loan_agreement/publish', {})).body.published.version).toBe(2)
  })
})

describe('an approved loan', () => {
  let id

  it('gets its offer letter and agreement from the published templates', async () => {
    id = await approvedLoan('offered@example.com')
    const documents = await waitFor(async () => {
      const { body } = await admin.get(`/applications/${id}`)
      const system = body.documents.filter((document) => document.source === 'system')
      return system.length === 2 ? system : null
    })
    const letter = documents.find((document) => document.docType === 'offer_letter')
    expect(letter.meta).toMatchObject({ kind: 'offer_letter', templateVersion: 2, templateSource: 'text', signed: false })
    const agreement = documents.find((document) => document.docType === 'loan_agreement')
    expect(agreement.meta).toMatchObject({ templateVersion: 2, templateSource: 'pdf' })
    expect(agreement.meta.signatureSpots).toHaveLength(1)

    // The fingerprint is of the stored file itself.
    const file = await officer.get(`/applications/${id}/documents/${agreement.id}`)
    expect(sha256(file.body)).toBe(agreement.meta.sha256)
  })

  it('fills the uploaded agreement’s fields and flattens its form', async () => {
    const { body } = await admin.get(`/applications/${id}`)
    const agreement = body.documents.find((document) => document.docType === 'loan_agreement')
    // Storage locations never reach the browser.
    expect(agreement.pathname).toBeUndefined()
    const file = await officer.get(`/applications/${id}/documents/${agreement.id}`)
    const doc = await PDFDocument.load(file.body)
    expect(doc.getForm().getFields()).toHaveLength(0)
    // Its fields were recognised, so no summary page was needed.
    expect(doc.getPageCount()).toBe(1)
  })

  it('shows them to the customer with the offer, apart from the documents they sent', async () => {
    const customer = client(handler)
    await kv.set('otp:offered@example.com', { code: '424242', attempts: 0, createdAt: Date.now() }, { ex: 600 })
    await customer.post('/auth/customer', { email: 'offered@example.com', code: '424242' })
    const { body } = await customer.get(`/me/applications/${id}`)
    expect(body.offerDocuments.map((document) => document.kind).sort()).toEqual(['loan_agreement', 'offer_letter'])
    expect(body.documents.every((document) => document.source !== 'system')).toBe(true)
    const letter = await customer.get(`/applications/${id}/documents/${body.offerDocuments.find((document) => document.kind === 'offer_letter').id}`)
    expect(letter.headers['content-type']).toBe('application/pdf')
  })
})
