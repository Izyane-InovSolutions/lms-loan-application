import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { buildProducts, matchingProduct, DEFAULT_LOAN_TYPES } = await import('../src/config/loanProducts.js')
const { checkRules, matchProducts, rulesForProduct, policyEligibilityRules, DEFAULT_ELIGIBILITY_RULES } = await import('../src/config/productEligibility.js')
const { DEFAULT_POLICIES } = await import('../src/config/creditRules.js')
// The net pay and revenue bands in the default policies: which products an income qualifies for.
const BANDS = policyEligibilityRules(DEFAULT_POLICIES)

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const applicant = client(handler)

const editable = ({ steps, requiredDocuments, ...product }) => product
const switchOn = async (...ids) => {
  const all = buildProducts((await admin.get('/settings')).body.settings.products)
  await admin.put('/settings/products', Object.fromEntries(ids.map((id) => [id, { ...editable(all.find((product) => product.id === id)), enabled: true }])))
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await switchOn('vehicle-loan', 'medical-loan', 'unsecured-personal-loan')
})

describe('product eligibility rules', () => {
  const products = buildProducts({ 'vehicle-loan': { enabled: true }, 'medical-loan': { enabled: true } })
  const vehicle = products.find((product) => product.id === 'vehicle-loan')
  const business = products.find((product) => product.id === 'business-term-loan')

  it('apply by product, by loan type, or to every product of a form that has the figure', () => {
    expect(rulesForProduct(vehicle, DEFAULT_ELIGIBILITY_RULES).map((rule) => rule.id)).toEqual(['e1', 'e2'])
    expect(rulesForProduct(business, DEFAULT_ELIGIBILITY_RULES).map((rule) => rule.id)).toEqual(['e1', 'e2', 'e4'])
    const byType = [{ id: 'x', fact: 'net_monthly_pay', operator: 'gte', value: 1, message: 'm', products: [], loanTypes: ['personal'], enabled: true }]
    expect(rulesForProduct(vehicle, byType)).toHaveLength(1)
    expect(rulesForProduct(business, byType)).toHaveLength(0)
  })

  it('fail on a figure that falls short, and skip one that is unknown', () => {
    const rules = [{ id: 'pay', fact: 'net_monthly_pay', operator: 'gte', value: 8000, message: 'You need net pay of at least K8,000.', products: ['vehicle-loan'], loanTypes: [], enabled: true }]
    expect(checkRules(vehicle, rules, { net_monthly_pay: 6000 }).failed[0]).toMatchObject({ message: 'You need net pay of at least K8,000.', actual: 'K6,000' })
    expect(checkRules(vehicle, rules, { net_monthly_pay: null })).toMatchObject({ failed: [], unchecked: [{ id: 'pay' }] })
  })

  it('match on document income first, stated income only when the documents gave none', () => {
    const offered = products.filter((product) => product.enabled && product.form === 'personal')
    const fromDocuments = matchProducts(offered, [], { net_monthly_pay: 6000 }, { form: 'personal', statedIncome: 50000 })
    expect(fromDocuments.income).toMatchObject({ income: 6000, source: 'documents' })
    expect(fromDocuments.products.find((result) => result.id === 'vehicle-loan')).toMatchObject({ status: 'eligible' })
    const stated = matchProducts(offered, BANDS, {}, { form: 'personal', statedIncome: 4000 })
    expect(stated.income.source).toBe('stated')
    expect(stated.products.find((result) => result.id === 'vehicle-loan')).toMatchObject({ status: 'ineligible', reasons: [expect.stringMatching(/at least K5,000/)] })
  })

  it('ask a matched applicant the documents every product needs, and the income evidence', () => {
    const match = matchingProduct(DEFAULT_LOAN_TYPES[0], products)
    expect(match).toMatchObject({ id: 'match-personal', matching: true, form: 'personal' })
    expect(match.documents.find((document) => document.slot === 'payslips')).toMatchObject({ required: true })
  })
})

describe('the policy’s net pay bands', () => {
  const products = buildProducts(Object.fromEntries(buildProducts().map((product) => [product.id, { enabled: true }])))
  const qualifying = (income) =>
    matchProducts(products.filter((product) => product.form === 'personal'), BANDS, {}, { form: 'personal', statedIncome: income })
      .products.filter((result) => result.status === 'eligible')
      .map((result) => result.id)

  it('decide which personal loans a net pay qualifies for', () => {
    expect(qualifying(1200)).not.toContain('medical-loan')
    expect(qualifying(1600)).toContain('medical-loan')
    expect(qualifying(4000)).toEqual(expect.arrayContaining(['unsecured-personal-loan', 'debt-consolidation-loan']))
    expect(qualifying(4000)).not.toContain('vehicle-loan')
    expect(qualifying(6000)).toContain('vehicle-loan')
    expect(qualifying(6000)).not.toContain('home-loan')
  })

  it('say which band the applicant falls short of', () => {
    const result = matchProducts(products.filter((product) => product.id === 'home-loan'), BANDS, {}, { form: 'personal', statedIncome: 6000 }).products[0]
    expect(result).toMatchObject({ status: 'ineligible', reasons: [expect.stringMatching(/at least K10,000/)] })
  })

  it('leave business loans to the revenue bands', () => {
    expect(BANDS.filter((rule) => rule.fact === 'net_monthly_pay').flatMap((rule) => rule.products)).not.toContain('business-microloan')
  })
})

describe('income typed against the documents', () => {
  it('flags figures more than 5% apart, either way', async () => {
    const { compareIncome } = await import('../src/config/eligibility.js')
    expect(compareIncome('12000', 11177.5)).toMatchObject({ stated: 12000, found: 11177.5, differs: true })
    expect(compareIncome('11400', 11177.5).differs).toBe(false)
    expect(compareIncome('9000', 11177.5).differs).toBe(true)
    expect(compareIncome('', 11177.5)).toBeNull()
  })

  it('lets a document issue be continued past, never affordability or another rule', () => {
    const products = buildProducts({ 'medical-loan': { enabled: true } }).filter((product) => product.id === 'medical-loan')
    const nameRule = [...DEFAULT_ELIGIBILITY_RULES.filter((rule) => rule.id === 'e2'), ...BANDS]
    const ageRule = DEFAULT_ELIGIBILITY_RULES.filter((rule) => rule.id === 'e1')
    expect(matchProducts(products, nameRule, { identity_mismatches: 1, net_monthly_pay: 9000 }, { form: 'personal' }).products[0]).toMatchObject({ status: 'ineligible', canContinue: true })
    expect(matchProducts(products, nameRule, { identity_mismatches: 1, net_monthly_pay: 100 }, { form: 'personal' }).products[0].canContinue).toBe(false)
    expect(matchProducts(products, ageRule, { applicant_age: 16, net_monthly_pay: 9000 }, { form: 'personal' }).products[0].canContinue).toBe(false)
  })
})

describe('we’ll match you', () => {
  it('are saved and published with the credit rules', async () => {
    const { published } = (await admin.get('/rules')).body
    expect(published.eligibility.map((rule) => rule.id)).toEqual(['e1', 'e2', 'e4'])
    const eligibility = [
      ...published.eligibility,
      { id: 'pay', fact: 'net_monthly_pay', operator: 'gte', value: 12000, message: 'Unsecured loans need net pay of at least K12,000.', products: ['unsecured-personal-loan', 'no-such-product'], loanTypes: [], enabled: true },
    ]
    expect((await admin.put('/rules/draft', { policies: published.policies, eligibility: [{ fact: 'crb_score', operator: 'gte', value: 1, message: 'x' }] })).body.code).toBe('invalid_rules')
    const saved = await admin.put('/rules/draft', { policies: published.policies, eligibility })
    expect(saved.body.draft.eligibility.at(-1).products).toEqual(['unsecured-personal-loan'])
    expect((await admin.post('/rules/publish', {})).status).toBe(200)
  })

  it('matches a draft to the products its documents qualify it for', async () => {
    // The payslip reads K10,000: medical and vehicle qualify; the unsecured loan's own rule wants K12,000.
    const { token, body } = await prepareDraft('matched@example.com')
    const match = await applicant.post('/match', { loanType: 'personal', data: body.data, commitments: 0 }, { authorization: `Bearer ${token}` })
    expect(match.status).toBe(200)
    expect(match.body.income).toMatchObject({ income: 10000, source: 'documents' })
    const result = (id) => match.body.products.find((entry) => entry.id === id)
    expect(result('vehicle-loan')).toMatchObject({ status: 'eligible', maxAmount: 95200 })
    expect(result('unsecured-personal-loan')).toMatchObject({ status: 'ineligible', reasons: ['Unsecured loans need net pay of at least K12,000.'] })
    // No token (no email given): matched on the answers and what they type; an expired one is refused.
    const untokened = await client(handler).post('/match', { loanType: 'personal', data: body.data, income: 4000 })
    expect(untokened.body.income).toMatchObject({ income: 4000, source: 'stated' })
    expect((await applicant.post('/match', { loanType: 'personal', data: body.data }, { authorization: 'Bearer expired' })).status).toBe(401)
  })

  it('names the document to replace when it is in someone else’s name', async () => {
    const { token, body } = await prepareDraft('someone-else@example.com')
    // Ada Banda's application, with Kayoka Zawadi's payslip: every loan is ruled out by the name rule.
    const analysis = { docType: 'payslips', matchesExpectedType: true, legibility: 'clear', extracted: { holderName: 'Kayoka Zawadi', netPay: '14000' }, issues: [], authenticityConcerns: ['Font differs'] }
    await kv.set('aiAnalysis:someone-else@example.com:payslips', { analysis, docType: 'payslips', filename: 'payslips.pdf', size: 16 })
    const match = (await applicant.post('/match', { loanType: 'personal', data: body.data }, { authorization: `Bearer ${token}` })).body
    expect(match.products.every((result) => result.status === 'ineligible')).toBe(true)
    expect(match.documentProblems).toEqual([{ slot: 'payslips', label: 'Latest three payslips', problems: ['This document is in the name of Kayoka Zawadi, but you entered Ada Banda.'] }])
    // Signs of tampering never reach the applicant.
    expect(JSON.stringify(match)).not.toMatch(/Font differs/)
    // Held back only by the document, and affordable: they may continue anyway.
    expect(match.products.find((result) => result.id === 'medical-loan')).toMatchObject({ canContinue: true, maxAmount: expect.any(Number) })

    const submit = (extra) =>
      applicant.post('/applications', { ...body, submissionKey: crypto.randomUUID(), loanData: { amount: 5000, tenure: 6, productId: 'medical-loan', matchType: 'personal', ...extra } }, { authorization: `Bearer ${token}` })
    expect((await submit()).body.message).toMatch(/must match what you entered/)
    const filed = await submit({ acceptDocumentIssues: true })
    expect(filed.status).toBe(200)
    const { eligibility } = (await admin.get(`/applications/${filed.body.id}`)).body.application.data
    expect(eligibility).toMatchObject({ route: 'match', documentIssuesAccepted: true, failed: [expect.objectContaining({ id: 'e2', document: true })] })
  })

  it('files a matched application on its documents, and refuses one the rules rule out', async () => {
    const { token, body } = await prepareDraft('matched-submit@example.com')
    const submit = (loanData) => applicant.post('/applications', { ...body, submissionKey: crypto.randomUUID(), loanData }, { authorization: `Bearer ${token}` })
    // Not yet chosen.
    expect((await submit({ amount: 5000, tenure: 6, productId: 'match-personal', matchType: 'personal' })).body.code).toBe('product_unavailable')
    // The unsecured loan's rule isn't met, whatever income is typed.
    expect((await submit({ amount: 5000, tenure: 12, productId: 'unsecured-personal-loan', matchType: 'personal', income: 90000 })).body.message).toBe('Unsecured loans need net pay of at least K12,000.')
    // The medical loan, on the K10,000 the payslip shows, with no income typed at all.
    const filed = await submit({ amount: 5000, tenure: 6, productId: 'medical-loan', matchType: 'personal' })
    expect(filed.status).toBe(200)
    const detail = (await admin.get(`/applications/${filed.body.id}`)).body
    expect(detail.application.data.eligibility).toMatchObject({ route: 'match', incomeSource: 'documents', income: 10000, documentIncome: 10000, failed: [] })
  })

  it('only flags, for the officer, a finder application that doesn’t meet the rules', async () => {
    const { token, body } = await prepareDraft('finder@example.com')
    const filed = await applicant.post(
      '/applications',
      { ...body, submissionKey: crypto.randomUUID(), loanData: { amount: 5000, tenure: 12, productId: 'unsecured-personal-loan', income: 30000 } },
      { authorization: `Bearer ${token}` }
    )
    expect(filed.status).toBe(200)
    const { eligibility } = (await admin.get(`/applications/${filed.body.id}`)).body.application.data
    expect(eligibility).toMatchObject({ route: 'finder', incomeSource: 'stated', income: 30000, documentIncome: 10000 })
    expect(eligibility.failed).toEqual([expect.objectContaining({ id: 'pay', actual: 'K10,000' })])
  })
})

describe('the website finder', () => {
  it('asks the server, which applies the policy’s net pay bands to the stated figures', async () => {
    const visitor = client(handler)
    const low = (await visitor.post('/match', { loanType: 'personal', income: '4000' })).body
    expect(low.products.find((result) => result.id === 'vehicle-loan')).toMatchObject({ status: 'ineligible', reasons: [expect.stringMatching(/at least K5,000/)] })
    expect(low.products.find((result) => result.id === 'medical-loan')).toMatchObject({ status: 'eligible' })
    const high = (await visitor.post('/match', { loanType: 'personal', income: '6000' })).body
    expect(high.products.find((result) => result.id === 'vehicle-loan')).toMatchObject({ status: 'eligible' })
  })
})
