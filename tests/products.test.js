import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF, createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { STANDARD_PRODUCTS, buildProducts, productDefaults } = await import('../src/config/loanProducts.js')
const { affordabilityError, eligibilityFor, productTags } = await import('../src/config/eligibility.js')
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
    // The two built-in products, then by when each was made: this one (January), then the 14 standard ones, off.
    expect(products.map((product) => product.id).slice(0, 4)).toEqual(['personal', 'business', 'civil-servant', 'unsecured-personal-loan'])
    expect(products.filter((product) => STANDARD_PRODUCTS[product.id])).toHaveLength(14)
    expect(products.filter((product) => STANDARD_PRODUCTS[product.id]).every((product) => !product.enabled && product.purpose)).toBe(true)
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

describe('qualifying on income', () => {
  const vehicle = buildProducts().find((product) => product.id === 'vehicle-loan')

  it('works out the largest loan whose instalment fits the budget', () => {
    // K10,000 net pay, 40% for repayments: K4,000 a month. 60 months at 2.5% a month, 2% fee.
    const result = eligibilityFor(vehicle, { income: 10000 })
    expect(result).toMatchObject({ status: 'eligible', budget: 4000, maxAmount: 95200 })
    expect(affordabilityError(vehicle, { income: 10000 }, 95200, 60)).toBeNull()
    expect(affordabilityError(vehicle, { income: 10000 }, 95300, 60)).toMatch(/more than your budget/)
    // A shorter tenure means a smaller loan.
    expect(affordabilityError(vehicle, { income: 10000 }, 95200, 24)).toMatch(/Borrow up to K/)
  })

  it('says why an applicant doesn’t qualify', () => {
    expect(eligibilityFor(vehicle, {})).toEqual({ status: 'unknown' })
    // Minimum net pay is the policy's to decide (Policy rules → Personal Policy), not the product's.
    expect(eligibilityFor(vehicle, { income: 4000 }).status).toBe('eligible')
    expect(eligibilityFor(vehicle, { income: 6000, commitments: 2400 }).reason).toMatch(/existing repayments/)
    const home = buildProducts().find((product) => product.id === 'home-loan')
    expect(eligibilityFor(home, { income: 10000, commitments: 3500 }).reason).toMatch(/smallest loan is K50,000/)
  })

  it('classifies products from their settings', () => {
    expect(productTags(vehicle)).toEqual(['Secured', 'Medium-term', 'Fixed rate'])
    expect(productTags(buildProducts().find((product) => product.id === 'business-term-loan'))).toEqual(['Secured from K250,000', 'Medium-term', 'Fixed rate'])
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

  it('groups products under loan types, which can be added and deleted once empty', async () => {
    const types = (await admin.get('/settings')).body.settings.loanTypes.types
    expect(types.map((type) => type.key)).toEqual(['personal', 'business'])
    const agri = { key: 'agricultural', label: 'Agricultural loans', description: 'For farmers', form: 'business' }
    expect((await admin.put('/settings/loanTypes', { types: [...types, agri] })).status).toBe(200)

    // A product can only join a type on its own form.
    const microloan = buildProducts().find((product) => product.id === 'business-microloan')
    const { steps, requiredDocuments, ...editable } = microloan
    expect((await admin.put('/settings/products', { 'business-microloan': { ...editable, loanType: 'personal' } })).body.message).toMatch(/only belong to a loan type that uses that form/)
    const moved = await admin.put('/settings/products', { 'business-microloan': { ...editable, loanType: 'agricultural' } })
    expect(moved.body.products['business-microloan'].loanType).toBe('agricultural')

    // A type with products stays; a form can't be changed once saved.
    expect((await admin.put('/settings/loanTypes', { types })).body.message).toMatch(/“Agricultural loans” still has 1 product/)
    const reformed = await admin.put('/settings/loanTypes', { types: [...types, { ...agri, form: 'personal' }] })
    expect(reformed.body.loanTypes.types.find((type) => type.key === 'agricultural').form).toBe('business')
    // Applicants are told the types with the products.
    expect((await applicant.get('/products')).body.loanTypes.map((type) => type.key)).toEqual(['personal', 'business', 'agricultural'])

    await admin.put('/settings/products', { 'business-microloan': { ...editable, loanType: 'business' } })
    const emptied = await admin.put('/settings/loanTypes', { types })
    expect(emptied.status).toBe(200)
    expect(emptied.body.loanTypes.types).toHaveLength(2)
    expect((await admin.put('/settings/loanTypes', { types: [] })).body.message).toMatch(/at least one/)
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
    body.loanData = { amount: 10000, tenure: 6, productId: 'civil-servant', income: 20000 }
    const submit = (changes = {}) => applicant.post('/applications', { ...body, submissionKey: crypto.randomUUID(), ...changes }, { authorization: `Bearer ${token}` })

    // Qualifying needs the income stated; the instalment must fit what it leaves (K800 net pay: K320 a month).
    expect((await submit({ loanData: { ...body.loanData, income: undefined } })).body.code).toBe('not_eligible')
    expect((await submit({ loanData: { ...body.loanData, income: 800 } })).body.message).toMatch(/more than your budget of K320/)

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
    expect(facts.stated_income).toBe(20000)
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

describe('deleting loan products', () => {
  const admin = client(handler)
  const officer = client(handler)

  beforeAll(async () => {
    await admin.post('/auth/demo', { role: 'admin' })
    await officer.post('/auth/demo', { role: 'loan_officer' })
  })

  it('removes a product nobody applied for, defaults and all', async () => {
    const deleted = await admin.del('/settings/products/education-loan')
    expect(deleted.body).toMatchObject({ kept: false, applications: 0 })
    expect(buildProducts(deleted.body.products).map((product) => product.id)).not.toContain('education-loan')
    expect((await admin.del('/settings/products/education-loan')).status).toBe(404)
  })

  it('keeps one applications were made under, for them only', async () => {
    const deleted = await admin.del('/settings/products/civil-servant')
    expect(deleted.body).toMatchObject({ kept: true, applications: 1 })
    expect(buildProducts(deleted.body.products).find((product) => product.id === 'civil-servant')).toMatchObject({ deleted: true, enabled: false })
    // Its application still names it; applicants can't choose it; it can't be edited back.
    const list = (await officer.get('/applications?product=civil-servant&status=')).body
    expect(list.applications[0].productName).toBe('Civil Servant Loan')
    expect(list.products.find((product) => product.id === 'civil-servant')).toMatchObject({ deleted: true })
    expect((await client(handler).get('/products')).body.products.map((product) => product.id)).not.toContain('civil-servant')
    expect((await admin.put('/settings/products', { 'civil-servant': { ...civilServant, enabled: true } })).body.message).toMatch(/was deleted/)
  })

  it('is for administrators only', async () => {
    expect((await officer.del('/settings/products/medical-loan')).status).toBe(403)
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

describe('the repayment schedule in the offer', () => {
  it('falls due a month after payout, month-ends kept, and adds up to the total', async () => {
    const { repaymentSchedule, priceLoan } = await import('../src/config/loanProducts.js')
    const personal = buildProducts()[0]
    const rows = repaymentSchedule(10000, 6, personal, new Date('2026-01-31T10:00:00Z'))
    expect(rows.map((row) => row.due.toISOString().slice(0, 10))).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31'])
    const total = rows.reduce((sum, row) => sum + row.amount, 0)
    expect(Math.round(total * 100) / 100).toBe(priceLoan(10000, 6, personal).total)
    expect(rows.at(-1).balance).toBe(0)
    const { MERGE_FIELDS } = await import('../src/config/templates.js')
    expect(MERGE_FIELDS.map((field) => field.key)).toEqual(expect.arrayContaining(['repayment_schedule', 'first_repayment_date']))
  })
})

describe('guarantors', () => {
  const admin = client(handler)
  const applicant = client(handler)
  const person = { name: 'Mutale Chanda', nrc: '234567/89/1', phone: '+260 971 234 569', email: '', relationship: 'Sibling', address: 'Roma, Lusaka' }

  it('are checked as the product asks', async () => {
    const { guarantorErrors, describeGuarantors } = await import('../src/config/guarantors.js')
    const required = { guarantors: { requirement: 'required' } }
    expect(guarantorErrors(required, {}).guarantors).toMatch(/needs a guarantor/)
    expect(guarantorErrors(required, { guarantors: [{ ...person, nrc: '2345' }] })['guarantors.0.nrc']).toMatch(/123456\/78\/9/)
    expect(guarantorErrors(required, { guarantors: [person] })).toEqual({})
    expect(guarantorErrors({ guarantors: { requirement: 'none' } }, {})).toEqual({})
    expect(describeGuarantors({ guarantors: [person] })).toBe('Mutale Chanda (NRC 234567/89/1, sibling)')
  })

  it('are required on submission where the product says so, and filed clean', async () => {
    await admin.post('/auth/demo', { role: 'admin' })
    const personal = buildProducts((await admin.get('/settings')).body.settings.products).find((product) => product.id === 'personal')
    const { steps, requiredDocuments, ...editable } = personal
    expect((await admin.put('/settings/products', { personal: { ...editable, guarantors: { requirement: 'required' } } })).status).toBe(200)

    const { token, body } = await prepareDraft('guaranteed@example.com')
    body.data.personalInfo.email = 'guaranteed@example.com'
    const submit = () => applicant.post('/applications', { ...body, submissionKey: crypto.randomUUID() }, { authorization: `Bearer ${token}` })
    expect((await submit()).body.code).toBe('invalid_guarantors')
    body.data.guarantors = [person, { name: '', nrc: '', phone: '', relationship: '', address: '' }]
    const filed = await submit()
    expect(filed.status, JSON.stringify(filed.body)).toBe(200)
    const officer = client(handler)
    await officer.post('/auth/demo', { role: 'loan_officer' })
    const { application } = (await officer.get(`/applications/${filed.body.id}`)).body
    expect(application.data.guarantors).toEqual([{ ...person, phone: '971234569' }])

    await admin.put('/settings/products', { personal: { ...editable, guarantors: { requirement: 'none' } } })
  })
})
