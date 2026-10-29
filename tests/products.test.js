import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF, createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { buildProducts, productDefaults } = await import('../src/config/loanProducts.js')
const { collateralErrors } = await import('../src/config/collateral.js')
const { describeSlot, requiredSlots } = await import('../src/config/applications.js')

const prepareDraft = draftPreparer(kv, putBlob)

const waitFor = async (check, attempts = 50) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting')
}

// A personal-form product that asks for an NRC and a letter of its own, and wants a vehicle worth 120% of the loan.
const civilServant = {
  ...productDefaults('personal'),
  name: 'Civil Servant Loan',
  tagline: 'For government employees',
  enabled: true,
  documents: [
    { slot: 'nrcCopy', label: 'NRC copy', required: true },
    { slot: 'custom.employer-letter', label: 'Employer confirmation letter', description: 'A letter from your ministry confirming your post.', required: true },
    { slot: 'payslips', label: 'Latest payslip', required: false },
  ],
  collateral: { requirement: 'required', types: ['motor_vehicle'], minCoverage: 1.2 },
}

describe('product and collateral rules', () => {
  it('keeps the built-in products and lays added ones over their form’s defaults', () => {
    const products = buildProducts({ personal: { maxAmount: 9000 }, 'civil-servant': { ...civilServant, createdAt: '2026-01-01' } })
    expect(products.map((product) => product.id)).toEqual(['personal', 'business', 'civil-servant'])
    expect(products[0].maxAmount).toBe(9000)
    expect(products[2]).toMatchObject({ form: 'personal', steps: expect.any(Array), requiredDocuments: ['NRC copy', 'Employer confirmation letter'] })
    expect(requiredSlots(products[2], {})).toEqual(['nrcCopy', 'custom.employer-letter'])
    expect(describeSlot(products[2], 'custom.employer-letter')).toMatchObject({ docType: 'custom', label: 'Employer confirmation letter' })
  })

  it('checks pledged collateral against the product', () => {
    const product = { collateral: civilServant.collateral }
    expect(collateralErrors(product, {}, 10000).collateral).toMatch(/needs collateral/)
    expect(collateralErrors(product, { collateral: { items: [{ type: 'stock', description: 'Shop stock', value: 20000 }] } }, 10000)['collateral.items.0.type']).toBeTruthy()
    expect(collateralErrors(product, { collateral: { items: [{ type: 'motor_vehicle', description: 'Toyota Hilux', value: 11000 }] } }, 10000).collateral).toMatch(/K12,000/)
    expect(collateralErrors(product, { collateral: { items: [{ type: 'motor_vehicle', description: 'Toyota Hilux', value: 12000 }] } }, 10000)).toEqual({})
    expect(collateralErrors({ collateral: { requirement: 'none' } }, {}, 10000)).toEqual({})
  })
})

describe('loan products in the workspace', () => {
  const admin = client(handler)
  const applicant = client(handler)

  beforeAll(async () => {
    await admin.post('/auth/demo', { role: 'admin' })
  })

  it('validates products and collateral types', async () => {
    expect((await admin.put('/settings/products', { 'Bad Id': civilServant })).status).toBe(400)
    expect((await admin.put('/settings/products', { 'civil-servant': { ...civilServant, documents: [{ slot: 'pacraCertificate', label: 'PACRA' }] } })).body.message).toMatch(/unknown document/)
    expect((await admin.put('/settings/products', { personal: { ...productDefaults('personal'), name: 'Personal Loan', enabled: false }, business: { ...productDefaults('business'), name: 'Business Loan', enabled: false } })).body.message).toMatch(/at least one/)

    // A type left out that no application uses is deleted.
    const saved = await admin.put('/settings/collateral', { types: [{ key: 'motor_vehicle', label: 'Motor vehicle', description: '' }, { key: 'livestock', label: 'Livestock', description: 'Cattle or goats' }] })
    expect(saved.status).toBe(200)
    expect(saved.body.collateral.types.map((type) => type.key)).toEqual(['motor_vehicle', 'livestock'])
    expect((await admin.put('/settings/collateral', { types: [] })).body.message).toMatch(/at least one/)
  })

  it('offers an added product, files only its documents and enforces its collateral', async () => {
    const created = await admin.put('/settings/products', { 'civil-servant': civilServant })
    expect(created.status).toBe(200)
    expect(created.body.products['civil-servant']).toMatchObject({ form: 'personal', createdAt: expect.any(String) })
    expect(created.body.products['civil-servant'].documents[1]).toMatchObject({ slot: 'custom.employer-letter', docType: 'custom' })

    const listed = await applicant.get('/products')
    expect(listed.body.products.map((product) => product.id)).toContain('civil-servant')

    const { token, body } = await prepareDraft('civil@example.com')
    body.data.personalInfo.email = 'civil@example.com'
    body.loanData = { amount: 10000, tenure: 6, productId: 'civil-servant' }
    const submit = (changes = {}) => applicant.post('/applications', { ...body, submissionKey: crypto.randomUUID(), ...changes }, { authorization: `Bearer ${token}` })

    // Its own document hasn't been uploaded yet.
    expect((await submit()).body.code).toBe('missing_documents')
    const path = 'personal.documents.custom.employer-letter'
    const stored = await putBlob('drafts/civil@example.com/letter.pdf', PDF, { contentType: 'application/pdf' })
    const draft = await kv.get('draft:civil@example.com')
    draft.documents[path] = { ...stored, filename: 'letter.pdf', contentType: 'application/pdf', size: PDF.length }
    await kv.set('draft:civil@example.com', draft)
    body.data.documents.custom = { 'employer-letter': { __draftFile__: path } }

    // Collateral: required, of an accepted type, worth 120% of the loan.
    expect((await submit()).body.code).toBe('invalid_collateral')
    body.data.collateral = { items: [{ type: 'motor_vehicle', description: 'Toyota Corolla ABC 1234', value: 9000 }] }
    expect((await submit()).body.message).toMatch(/K12,000/)
    body.data.collateral.items[0].value = 15000

    // A product that's off, or one used with the wrong form, can't be applied for.
    expect((await submit({ loanType: 'business' })).body.code).toBe('product_unavailable')

    const response = await submit()
    expect(response.status).toBe(200)
    const officer = client(handler)
    await officer.post('/auth/demo', { role: 'loan_officer' })
    const detail = (await officer.get(`/applications/${response.body.id}`)).body
    expect(detail.application.productId).toBe('civil-servant')
    expect(detail.product.name).toBe('Civil Servant Loan')
    // The draft's bank statement, TPIN and photo aren't asked for by this product, so aren't filed.
    expect(detail.documents.map((document) => document.slot).sort()).toEqual(['custom.employer-letter', 'nrcCopy', 'payslips'])
    expect(detail.documents.find((document) => document.slot === 'custom.employer-letter')).toMatchObject({ docType: 'custom', label: 'Employer confirmation letter' })
    const facts = (await waitFor(async () => (await officer.get(`/applications/${response.body.id}`)).body.prescreen)).facts
    expect(facts.collateral_value).toBe(15000)
    expect(facts.collateral_cover).toBe(1.5)

    // Now an application names it, deleting the type only switches it off.
    const kept = await admin.put('/settings/collateral', { types: [{ key: 'livestock', label: 'Livestock', description: '' }] })
    expect(kept.body.collateral.types.find((type) => type.key === 'motor_vehicle')).toMatchObject({ retired: true })
    await admin.put('/settings/collateral', { types: [{ key: 'motor_vehicle', label: 'Motor vehicle', description: '' }, { key: 'livestock', label: 'Livestock', description: '' }] })

    const list = (await officer.get('/applications?product=civil-servant&status=')).body
    expect(list.applications.map((row) => row.id)).toEqual([response.body.id])
    expect(list.applications[0].productName).toBe('Civil Servant Loan')

    // Switched off: no longer offered to applicants.
    await admin.put('/settings/products', { 'civil-servant': { ...civilServant, enabled: false } })
    expect((await applicant.get('/products')).body.products.map((product) => product.id)).not.toContain('civil-servant')
  })
})

describe('answers that change what is asked', () => {
  it('asks for payslips only from salaried applicants, and Form 2 and a board resolution only from companies', async () => {
    const { documentApplies, employerField, businessPeople } = await import('../src/config/applicantRules.js')
    const personal = (occupation) => ({ employmentInfo: { occupation } })
    expect(requiredSlots('personal', personal('Self-employed'))).not.toContain('payslips')
    expect(requiredSlots('personal', personal('Civil servant'))).toContain('payslips')
    // Free text from before the list existed: asked as before.
    expect(requiredSlots('personal', personal('Teacher'))).toContain('payslips')
    expect(employerField('Self-employed').label).toBe('Business name')
    expect(employerField('Retired')).toBeNull()

    const business = (businessType) => ({ businessInfo: { businessType }, directorInfo: { directors: [{}] } })
    expect(requiredSlots('business', business('Sole Proprietorship'))).not.toContain('form2')
    expect(requiredSlots('business', business('Partnership'))).not.toContain('boardResolution')
    expect(requiredSlots('business', business('Limited Liability Company (LLC)'))).toEqual(expect.arrayContaining(['form2', 'boardResolution']))
    expect(documentApplies('bankStatements', 'business', business('Sole Proprietorship'))).toBe(true)
    expect(businessPeople('Sole Proprietorship')).toMatchObject({ one: 'Owner', max: 1 })
  })
})

describe('applicants who aren’t Zambian', () => {
  it('ask for a passport copy in place of the NRC copy, and the passport number on it', async () => {
    const { presentDocuments, positionLabel, positionsFor } = await import('../src/config/applicantRules.js')
    const { findFormMismatches } = await import('../src/utils/documentChecks.js')
    const foreign = { employmentInfo: { nationality: 'Malawi', occupation: 'Employed' } }
    expect(requiredSlots('personal', foreign)).toContain('passportCopy')
    expect(requiredSlots('personal', foreign)).not.toContain('nrcCopy')
    expect(requiredSlots('personal', { employmentInfo: { nationality: 'Zambia' } })).toContain('nrcCopy')
    expect(presentDocuments(buildProducts().find((product) => product.id === 'personal'), foreign).find((entry) => entry.slot === 'passportCopy')).toMatchObject({ docType: 'passport', required: true })
    expect(describeSlot('personal', 'passportCopy')).toMatchObject({ docType: 'passport', label: 'Passport copy' })
    expect(findFormMismatches({ extracted: { passportNumber: 'MA123456' } }, { passport: 'MA999999' })).toHaveLength(1)

    expect(positionsFor('Partnership')).toEqual(['Partner', 'Manager', 'Other'])
    expect(positionLabel({ applicantPosition: 'Other', applicantPositionOther: 'Finance manager' })).toBe('Finance manager')
  })
})
