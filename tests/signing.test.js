import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createMemoryKv, client, draftPreparer, signedAcceptance, emailCode } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { sha256 } = await import('../api/_lib/pdf.js')

const prepareDraft = draftPreparer(kv, putBlob)

const admin = client(handler)
const officer = client(handler)
const dsa = client(handler)
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
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}

const approvedLoan = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const { body: submitted } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  await act(officer, submitted.id, 'start_review')
  for (const check of ['identity', 'documents', 'income']) await act(officer, submitted.id, 'check', { check, done: true, note: 'Seen' })
  await act(officer, submitted.id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
  const decided = await act(admin, submitted.id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
  expect(decided.body.application.status).toBe('approved')
  // The offer documents are made just after the decision.
  await waitFor(async () => (await admin.get(`/applications/${submitted.id}`)).body.documents.filter((document) => document.source === 'system').length === 2)
  return submitted.id
}

const customerFor = async (email) => {
  const customer = client(handler)
  await emailCode(kv, 'login', email, '101010')
  await customer.post('/auth/customer', { email, code: '101010' })
  return customer
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await dsa.post('/auth/demo', { role: 'dsa' })
})

describe('the customer signs their offer', () => {
  let id
  let customer

  it('can’t accept without signing, agreeing and the emailed code', async () => {
    id = await approvedLoan('signer@example.com')
    customer = await customerFor('signer@example.com')
    const bare = await customer.post(`/me/applications/${id}/accept`, {})
    expect(bare.body.code).toBe('agreement_required')
    const good = await signedAcceptance(kv, 'signer@example.com')
    expect((await customer.post(`/me/applications/${id}/accept`, { ...good, signature: { name: 'Ada Banda', image: '' } })).body.code).toBe('signature_required')
    expect((await customer.post(`/me/applications/${id}/accept`, { ...good, code: '000000' })).status).toBe(400)
    // Nothing was signed by the failed attempts.
    const { body } = await admin.get(`/applications/${id}`)
    expect(body.signatures).toHaveLength(0)
    expect(body.application.status).toBe('approved')
  })

  it('accepts with a signature, keeping signed copies and the evidence', async () => {
    const accepted = await customer.post(`/me/applications/${id}/accept`, await signedAcceptance(kv, 'signer@example.com', { name: 'Ada T. Banda' }))
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)

    const { body } = await admin.get(`/applications/${id}`)
    expect(body.application.status).toBe('accepted')
    const [signature] = body.signatures
    expect(signature).toMatchObject({ signerName: 'Ada T. Banda', signerEmail: 'signer@example.com', method: 'drawn', codeVerified: true, capturedBy: null })
    expect(signature.documents.map((entry) => entry.kind).sort()).toEqual(['loan_agreement', 'offer_letter'])

    for (const entry of signature.documents) {
      const original = body.documents.find((document) => document.id === entry.documentId)
      const signedCopy = body.documents.find((document) => document.id === entry.signedDocumentId)
      expect(entry.sha256).toBe(original.meta.sha256)
      expect(signedCopy.meta).toMatchObject({ signed: true, signatureId: signature.id, sha256: entry.signedSha256 })
      const file = await officer.get(`/applications/${id}/documents/${signedCopy.id}`)
      expect(sha256(file.body)).toBe(entry.signedSha256)
      const originalFile = await officer.get(`/applications/${id}/documents/${original.id}`)
      // The signed copy is the original plus a signature record page.
      expect((await PDFDocument.load(file.body)).getPageCount()).toBe((await PDFDocument.load(originalFile.body)).getPageCount() + 1)
    }
    expect(body.consents.find((consent) => consent.type === 'offer')).toMatchObject({ method: 'signature_and_code' })
    expect(body.events.some((event) => event.message === 'Offer accepted and signed by Ada T. Banda')).toBe(true)
  })

  it('shows the customer their signed copies', async () => {
    const { body } = await customer.get(`/me/applications/${id}`)
    expect(body.offerDocuments.every((document) => document.signed)).toBe(true)
    expect(body.offerDocuments.map((document) => document.label).sort()).toEqual(['Loan agreement (signed)', 'Offer letter (signed)'])
  })
})

describe('signing in person', () => {
  it('has the customer sign on the staff device, with their code', async () => {
    const id = await approvedLoan('in-person@example.com')
    const input = await signedAcceptance(kv, 'in-person@example.com', { name: 'Chipo Mwale' })
    expect((await act(officer, id, 'record_acceptance', { code: input.code })).body.code).toBe('signature_required')
    const accepted = await act(officer, id, 'record_acceptance', input)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    const { body } = await admin.get(`/applications/${id}`)
    expect(body.application.status).toBe('accepted')
    expect(body.signatures[0]).toMatchObject({ signerName: 'Chipo Mwale', capturedBy: expect.any(String) })
  })

  it('removes the signed copies when the acceptance itself fails', async () => {
    const id = await approvedLoan('stale@example.com')
    const input = await signedAcceptance(kv, 'stale@example.com')
    // A stale screen: the version sent is out of date.
    const stale = await officer.post(`/applications/${id}/actions`, { action: 'record_acceptance', version: 0, ...input })
    expect(stale.body.code).toBe('stale')
    const { body } = await admin.get(`/applications/${id}`)
    expect(body.signatures).toHaveLength(0)
    expect(body.documents.filter((document) => document.meta?.signed)).toHaveLength(0)
  })
})

describe('with signing switched off', () => {
  it('accepts with the tick box alone', async () => {
    const offers = (await admin.get('/settings')).body.settings.offers
    await admin.put('/settings/offers', { ...offers, requireSignature: false })
    const id = await approvedLoan('no-signature@example.com')
    const customer = await customerFor('no-signature@example.com')
    expect((await customer.post(`/me/applications/${id}/accept`, {})).status).toBe(200)
    expect((await admin.get(`/applications/${id}`)).body.signatures).toHaveLength(0)
    await admin.put('/settings/offers', { ...offers, requireSignature: true })
  })
})
