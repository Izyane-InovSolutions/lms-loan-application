import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF, createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { buildProducts, productDefaults } = await import('../src/config/loanProducts.js')
const { collateralErrors, collateralRequirement } = await import('../src/config/collateral.js')
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

// A personal-form product that asks for an NRC and a letter of its own, and wants a vehicle whose lending value covers the loan.
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
  collateral: { requirement: 'required', types: ['motor_vehicle'], mustCover: true },
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
    const pledge = (code, value) => ({ collateral: { items: [{ code, description: 'Toyota Hilux', value }] } })
    expect(collateralErrors(product, {}, 10000).collateral).toMatch(/needs collateral/)
    // A stock item isn't of a type this product accepts.
    expect(collateralErrors(product, pledge('ST-INV', 20000), 10000)['collateral.items.0.code']).toBeTruthy()
    // A vehicle: 30% haircut, 70% LTV, so K20,000 lends K9,800.
    expect(collateralErrors(product, pledge('MV-CAR', 20000), 10000).collateral).toMatch(/K9,800/)
    expect(collateralErrors(product, pledge('MV-CAR', 21000), 10000)).toEqual({})
    expect(collateralErrors({ collateral: { requirement: 'none' } }, {}, 10000)).toEqual({})
  })

  it('asks for collateral from an amount up when the product says so', () => {
    const product = { collateral: { requirement: 'amount', requiredFrom: 50000, types: [] } }
    expect(collateralRequirement(product, 49999)).toBe('none')
    expect(collateralRequirement(product, 50000)).toBe('required')
    expect(collateralErrors(product, {}, 10000)).toEqual({})
    expect(collateralErrors(product, {}, 60000).collateral).toMatch(/needs collateral/)
    // Rules saved with a minimum cover read as "must cover the loan".
    expect(buildProducts({ personal: { collateral: { requirement: 'required', types: [], minCoverage: 1.2 } } })[0].collateral).toMatchObject({ mustCover: true, requiredFrom: null })
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

    // A type left out that no application uses is deleted, unless an item still uses it.
    const types = [
      { key: 'motor_vehicle', label: 'Motor vehicle', haircut: 0.3, ltv: 0.7 },
      { key: 'livestock', label: 'Livestock', haircut: 0.2, ltv: 0.5 },
    ]
    const items = [
      { code: 'mv-car', type: 'motor_vehicle', name: 'Passenger vehicle' },
      { code: 'LS-CAT', type: 'livestock', name: 'Cattle' },
    ]
    expect((await admin.put('/settings/collateral', { types })).body.message).toMatch(/LB-RES still uses the type/)
    expect((await admin.put('/settings/collateral', { types: [{ ...types[0], haircut: 1.5 }], items: items.slice(0, 1) })).body.message).toMatch(/haircut must be from 0% to 99%/)
    expect((await admin.put('/settings/collateral', { types, items: [...items, { code: 'LS-CAT', type: 'livestock', name: 'Goats' }] })).body.message).toMatch(/used twice/)
    const saved = await admin.put('/settings/collateral', { types, items })
    expect(saved.status).toBe(200)
    expect(saved.body.collateral.types.map((type) => type.key)).toEqual(['motor_vehicle', 'livestock'])
    expect(saved.body.collateral.items.map((item) => item.code)).toEqual(['MV-CAR', 'LS-CAT'])
    expect((await admin.put('/settings/collateral', { types: [], items: [] })).body.message).toMatch(/at least one/)
    expect((await admin.put('/settings/products', { 'civil-servant': { ...civilServant, collateral: { requirement: 'amount', types: [] } } })).body.message).toMatch(/amount collateral is required from/)
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

    // Collateral: required, an item of an accepted type, lending at least the loan (vehicle: 30% haircut, 70% LTV).
    expect((await submit()).body.code).toBe('invalid_collateral')
    body.data.collateral = { items: [{ code: 'MV-CAR', description: 'Toyota Corolla ABC 1234', value: 9000 }] }
    expect((await submit()).body.message).toMatch(/K4,410/)
    body.data.collateral.items[0].value = 25000

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
    expect(facts.collateral_value).toBe(25000)
    expect(facts.collateral_cover).toBe(2.5)
    expect(facts.collateral_lending_value).toBe(12250)
    expect(facts.collateral_lending_cover).toBe(1.225)
    // Filed with its item's name and today's haircut and LTV, so later changes don't revalue it.
    expect(detail.application.data.collateral.items[0]).toMatchObject({ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', haircut: 0.3, ltv: 0.7, value: 25000 })

    // Now an application names them, deleting the type and its item only switches them off.
    const kept = await admin.put('/settings/collateral', { types: [{ key: 'livestock', label: 'Livestock', haircut: 0.2, ltv: 0.5 }], items: [{ code: 'LS-CAT', type: 'livestock', name: 'Cattle' }] })
    expect(kept.status).toBe(200)
    expect(kept.body.collateral.types.find((type) => type.key === 'motor_vehicle')).toMatchObject({ retired: true })
    expect(kept.body.collateral.items.find((item) => item.code === 'MV-CAR')).toMatchObject({ retired: true })
    await admin.put('/settings/collateral', {
      types: [
        { key: 'motor_vehicle', label: 'Motor vehicle', haircut: 0.3, ltv: 0.7 },
        { key: 'livestock', label: 'Livestock', haircut: 0.2, ltv: 0.5 },
      ],
      items: [
        { code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle' },
        { code: 'LS-CAT', type: 'livestock', name: 'Cattle' },
      ],
    })

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

describe('why a rule couldn’t be checked', () => {
  it('says why, what to do, and which button does it, and still reads as one sentence', async () => {
    const { factReasonDetails, factReasons } = await import('../api/_lib/prescreen/reasons.js')
    const application = { loanType: 'personal', data: { employmentInfo: { occupation: 'Employed' } }, submittedAt: new Date().toISOString() }
    const statement = { docType: 'bankStatements', aiAnalysis: { matchesExpectedType: false, detectedType: 'invoice' } }
    const facts = { average_monthly_credits: null, instalment_to_credits: null, net_monthly_pay: null, debt_to_income: null }
    const details = factReasonDetails(application, [statement], facts, { aiOn: true, distance: { why: 'The address couldn’t be found.', fix: 'Check the address with the applicant.', action: 'ask_applicant' } })

    expect(details.average_monthly_credits).toMatchObject({ why: expect.stringContaining('(it looks like an invoice)'), action: 'ask_applicant' })
    expect(details.average_monthly_credits.fix).toMatch(/^Ask the applicant for the right document/)
    // A ratio carries the same fix as the figure under it.
    expect(details.instalment_to_credits).toMatchObject({ why: expect.stringMatching(/^The instalment can’t be compared/), action: 'ask_applicant' })
    expect(details.net_monthly_pay).toMatchObject({ why: 'No payslip was uploaded.', action: 'ask_applicant' })
    expect(details.location_distance_km).toMatchObject({ fix: 'Check the address with the applicant.', action: 'ask_applicant' })
    expect(factReasons(application, [statement], facts, { aiOn: true }).average_monthly_credits).toMatch(/invoice\)\. Ask the applicant/)
  })
})
