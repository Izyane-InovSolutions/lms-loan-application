import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, documentVerifier, draftPreparer, toDecision, emailCode, signedAcceptance } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { legacyToWorkflow } = await import('../src/config/workflow.js')
const { lusakaDate, summarizeTerms } = await import('../src/config/loanTerms.js')
const { mergeValuesFor } = await import('../api/_lib/offerDocuments.js')
const { buildPayload } = await import('../api/_lib/lms/sync.js')
const { MERGE_FIELD_KEYS, fillPlaceholders, unknownPlaceholders } = await import('../src/config/templates.js')
const { getPublishedTemplate } = await import('../api/_lib/templates.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}
const act = async (who, id, action, extra = {}) => {
  const { version } = (await admin.get(`/applications/${id}`)).body.application
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}
const validTerms = { amount: 5000, tenure: 6, frequency: 'monthly', annualRate: 24, interestType: 'fixed', calculation: 'flat', effectiveDate: '2026-12-01', charges: [{ name: 'Processing fee', type: 'percent', value: 2 }] }

const termsDefinition = (definition) => ({
  ...definition,
  states: definition.states.map((state) => {
    if (state.id !== 'appraisal') return state
    return { ...state, appraisal: false, work: 'terms' }
  }),
})

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('loan terms on the case', () => {
  let before
  let caseId

  it('keeps a terms stage in a saved workflow and drops unknown work', async () => {
    const { published } = (await admin.get('/admin/workflow')).body
    const draft = termsDefinition(published.definition)
    const odd = await admin.put('/admin/workflow/draft', { definition: { ...draft, states: draft.states.map((state) => (state.id === 'appraisal' ? { ...state, work: 'other' } : state)) } })
    expect(odd.body.draft.definition.states.find((state) => state.id === 'appraisal').work).toBeUndefined()
    const saved = await admin.put('/admin/workflow/draft', { definition: draft })
    expect(saved.body.draft.definition.states.find((state) => state.id === 'appraisal').work).toBe('terms')
    const publish = await admin.post('/admin/workflow/publish', {})
    expect(publish.status, JSON.stringify(publish.body)).toBe(200)
  })

  it('refuses to save terms outside the terms stage', async () => {
    before = await submit('terms-before@example.com')
    const response = await act(officer, before, 'save_terms', { terms: validTerms })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('invalid_state')
  })

  it('rejects invalid terms and saves valid ones', async () => {
    caseId = await submit('terms-case@example.com')
    expect((await act(officer, caseId, 'start_review')).status).toBe(200)
    const workflow = (await officer.get(`/applications/${caseId}`)).body.workflow
    expect(workflow.state).toMatchObject({ work: 'terms', termsHold: 'the loan terms' })
    expect(workflow.workStages.terms).toBe('current')

    const invalid = await act(officer, caseId, 'save_terms', { terms: { ...validTerms, annualRate: 0 } })
    expect(invalid.status).toBe(400)
    expect(invalid.body.code).toBe('invalid_terms')
    expect(invalid.body.errors.annualRate).toBeTruthy()

    const saved = await act(officer, caseId, 'save_terms', { terms: validTerms })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const { application, events, workflow: after } = (await officer.get(`/applications/${caseId}`)).body
    expect(application.terms.summary.instalment).toBeGreaterThan(0)
    expect(application.terms).toMatchObject({ amount: 5000, savedByName: expect.any(String) })
    expect(JSON.stringify(events)).toMatch(/Loan terms saved/)
    expect(after.state.termsHold).toBeNull()
  })

  it('holds the stage move until terms are saved', async () => {
    const held = await submit('terms-held@example.com')
    await act(officer, held, 'start_review')
    const workflow = (await officer.get(`/applications/${held}`)).body.workflow
    expect(workflow.actions.find((action) => action.id === 'appraised').blocked).toBe('Moves on once the loan terms are saved.')
    const refused = await act(officer, held, 'transition', { actionId: 'appraised' })
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('terms_incomplete')

    const moved = await act(officer, caseId, 'transition', { actionId: 'appraised' })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    const { application } = (await officer.get(`/applications/${caseId}`)).body
    expect(application.state).not.toBe('appraisal')
    expect(application.approvedAmount ?? null).toBeNull()
    expect((await officer.get(`/applications/${caseId}`)).body.workflow.workStages.terms).toBe('passed')
  })
})

describe('the decision uses the appraised terms', () => {
  const appraised = { amount: 12000, tenure: 12, frequency: 'monthly', annualRate: 24, interestType: 'fixed', calculation: 'reducing', effectiveDate: '2026-12-01', charges: [{ name: 'Processing fee', type: 'percent', value: 2 }] }
  const approver = client(handler)

  const toRecommend = async (email, saved = appraised) => {
    const id = await submit(email)
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    await toDecision((action, extra) => act(officer, id, action, extra), { terms: saved, verify: documentVerifier(officer, id) })
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    return id
  }

  beforeAll(async () => {
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    await approver.post('/auth/demo', { role: 'sales_manager' })
  })

  it('recommends and approves the appraised amount, whatever the dialog sends', async () => {
    const id = await toRecommend('terms-decide@example.com')
    const recommended = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable', amount: 5000, tenure: 6 })
    expect(recommended.status, JSON.stringify(recommended.body)).toBe(200)
    expect(recommended.body.appraisals.find((row) => row.kind === 'recommendation')).toMatchObject({ amount: 12000, tenure: 12 })

    const decided = await act(approver, id, 'decide', { verdict: 'approve', rationale: 'Agreed', amount: 3000 })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    const { application } = (await admin.get(`/applications/${id}`)).body
    const summary = summarizeTerms(application.terms)
    expect(application).toMatchObject({ approvedAmount: 12000, approvedTenure: 12 })
    expect(Number(application.monthlyInstalment)).toBeCloseTo(summary.instalment, 2)
    expect(Number(application.totalRepayable)).toBeCloseTo(summary.totalRepayable, 2)
  })

  it('leaves the approved amount empty on a decline', async () => {
    const id = await toRecommend('terms-decline@example.com')
    expect((await act(officer, id, 'recommend', { verdict: 'decline', rationale: 'Too risky' })).status).toBe(200)
    const decided = await act(approver, id, 'decide', { verdict: 'decline', rationale: 'Agreed' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    const { application } = (await admin.get(`/applications/${id}`)).body
    expect(application.status).toBe('declined')
    expect(application.approvedAmount ?? null).toBeNull()
  })
})

describe('the offer, payout and LMS use the terms', () => {
  const approver = client(handler)
  const appraised = { amount: 50000, tenure: 12, frequency: 'monthly', annualRate: 24, interestType: 'fixed', calculation: 'reducing', effectiveDate: '2099-01-10', charges: [{ name: 'Processing fee', type: 'fixed', value: 7000 }] }
  let id
  let reference
  const applicationRow = async () => (await admin.get(`/applications/${id}`)).body.application

  it('fills the offer’s merge fields from the terms, dated from the effective date', async () => {
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    await approver.post('/auth/demo', { role: 'sales_manager' })
    id = await submit('terms-offer@example.com')
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    await toDecision((action, extra) => act(officer, id, action, extra), { terms: appraised, verify: documentVerifier(officer, id) })
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    expect((await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })).status).toBe(200)
    const decided = await act(approver, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)

    const application = await applicationRow()
    reference = application.reference
    const values = await mergeValuesFor(application)
    expect(MERGE_FIELD_KEYS).toEqual(expect.arrayContaining(['interest_rate', 'charges', 'net_disbursed', 'instalment', 'number_of_instalments']))
    expect(values).toMatchObject({ net_disbursed: 'K43,000.00', total_charges: 'K7,000.00', interest_rate: '24% a year', calculation_method: 'Reducing balance', repayment_frequency: 'Monthly', number_of_instalments: '12', charges: 'Processing fee: K7,000.00', effective_date: '10 January 2099', first_repayment_date: '10 February 2099' })
    expect(values.instalment).toBe(values.monthly_instalment)
    expect(values.repayment_schedule).toMatch(/1\. 10 February 2099: K/)
    return values
  })

  it('dates the schedule from the payout once paid out, with the same amounts', async () => {
    const before = await applicationRow()
    const earlier = await mergeValuesFor(before)
    const customer = client(handler)
    await emailCode(kv, 'login', 'terms-offer@example.com', '737373')
    await customer.post('/auth/customer', { email: 'terms-offer@example.com', code: '737373' })
    const mine = (await customer.get(`/me/applications/${id}`)).body.application
    expect(mine.offer).toMatchObject({ frequency: 'monthly', netDisbursed: 43000, totalCharges: 7000 })
    expect(mine.repaymentFrequency).toBe('monthly')
    expect(mine.terms).toBeUndefined()
    expect(mine.offer.charges).toBeUndefined()
    const accepted = await customer.post(`/me/applications/${id}/accept`, await signedAcceptance(kv, 'terms-offer@example.com'))
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    const paid = await act(officer, id, 'mark_disbursed')
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)

    const application = await applicationRow()
    const today = lusakaDate()
    expect(application.terms.paidOutOn).toBe(today)
    const values = await mergeValuesFor(application)
    const first = new Date(today)
    first.setUTCMonth(first.getUTCMonth() + 1)
    const amounts = (text) => [...text.matchAll(/: (K[\d,.]+) \(/g)].map((match) => match[1])
    expect(values.repayment_schedule).toMatch(/^Paid out on /)
    expect(values.repayment_schedule).not.toContain('2099')
    expect(amounts(values.repayment_schedule)).toEqual(amounts(earlier.repayment_schedule))
    expect(values.first_repayment_date).toBe(new Date(first).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lusaka' }))
  })

  it('hands the LMS the terms and the schedule', async () => {
    const application = await applicationRow()
    const { payload } = { payload: buildPayload({ ...application, data: (await admin.get(`/applications/${id}`)).body.application.data }, {}) }
    expect(payload).toMatchObject({ amount: 50000, tenure: '12', scheduleBasis: 'payout_date', approvedAmount: 50000, interestRatePercentPerYear: 24, interestType: 'fixed', calculationMethod: 'reducing', repaymentFrequency: 'monthly', netDisbursed: 43000, charges: [{ name: 'Processing fee', amount: 7000 }] })
    expect(payload.schedule).toHaveLength(12)
    expect(payload.schedule[0]).toMatchObject({ number: 1, dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), instalment: expect.any(Number), principal: expect.any(Number), interest: expect.any(Number), balance: expect.any(Number) })
    expect(payload.schedule[0].dueDate).not.toMatch(/^2099/)
    expect(reference).toBeTruthy()
  })

  it('renders a case without terms as before', async () => {
    const plain = await submit('terms-none@example.com')
    const application = (await admin.get(`/applications/${plain}`)).body.application
    const values = await mergeValuesFor(application)
    expect(values.facility_fee).toBeDefined()
    expect(values.charges).toBe('')
    expect(values.interest_rate).toBe('')
    expect(values.instalment).toBe(values.monthly_instalment)
    // Today's pricing adds the fee to what is repaid: the whole amount is paid out, monthly.
    expect(values.net_disbursed).toBe(values.amount)
    expect(values).toMatchObject({ number_of_instalments: String(application.tenure), repayment_frequency_lower: 'monthly' })
  })

  it('fills the default letters from weekly, reducing-balance terms with two charges', async () => {
    const plain = await submit('terms-weekly@example.com')
    const application = (await admin.get(`/applications/${plain}`)).body.application
    const terms = { amount: 20000, tenure: 6, frequency: 'weekly', annualRate: 24, interestType: 'fixed', calculation: 'reducing', effectiveDate: '2099-01-10', charges: [{ name: 'Processing fee', type: 'percent', value: 2 }, { name: 'Insurance', type: 'fixed', value: 150 }] }
    const summary = summarizeTerms(terms)
    // Before approval the case's own instalment is the product's monthly one: the terms win.
    const values = await mergeValuesFor({ ...application, terms, approvedAmount: 20000, approvedTenure: 6, monthlyInstalment: 999999, totalRepayable: summary.totalRepayable })
    const kwacha = (value) => `K${value.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    expect(values).toMatchObject({
      interest: '24% a year, reducing balance',
      interest_amount: kwacha(summary.totalInterest),
      facility_fee: kwacha(summary.totalCharges),
      instalment: kwacha(summary.instalment),
      monthly_instalment: kwacha(summary.instalment),
      number_of_instalments: String(summary.periods),
      repayment_frequency_lower: 'weekly',
      charges: 'Processing fee: K400.00\nInsurance: K150.00',
      net_disbursed: 'K19,450.00',
    })
    for (const kind of ['offer_letter', 'loan_agreement']) {
      const { body } = await getPublishedTemplate(kind)
      expect(unknownPlaceholders(body)).toEqual([])
      const letter = fillPlaceholders(body, values)
      expect(letter).toContain(`${summary.periods} weekly instalments of ${kwacha(summary.instalment)}`)
      expect(letter).toContain('Processing fee: K400.00\nInsurance: K150.00')
      expect(letter).toContain('after charges: K19,450.00')
      expect(letter).toContain(kwacha(summary.totalInterest))
      expect(letter).not.toMatch(/monthly/i)
    }
  })
})

describe('an older workflow version without appraised terms', () => {
  const approver = client(handler)

  it('still takes the amount from the dialog and leaves terms empty', async () => {
    const base = legacyToWorkflow({})
    const decision = base.states.find((state) => state.id === 'decision')
    const definition = {
      ...base,
      legacy: undefined,
      states: base.states
        .filter((state) => state.id !== 'decision')
        .map((state) => {
          if (state.id === 'appraisal') return { ...state, work: undefined, appraisal: true, actions: [{ id: 'appraised', label: 'Appraisal done', kind: 'move', to: 'in_review', permission: 'cases.work' }] }
          if (state.id === 'in_review') return { ...state, work: undefined, actions: decision.actions }
          return state
        }),
    }
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    const saved = await admin.put('/admin/workflow/draft', { definition })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const published = await admin.post('/admin/workflow/publish', {})
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    await approver.post('/auth/demo', { role: 'sales_manager' })

    const id = await submit('terms-old@example.com')
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    const asked = (await admin.get(`/applications/${id}`)).body.application.amount
    const amount = asked === 4000 ? 4500 : 4000
    const recommended = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable', amount })
    expect(recommended.status, JSON.stringify(recommended.body)).toBe(200)
    expect(recommended.body.appraisals.find((row) => row.kind === 'recommendation').amount).toBe(amount)
    const decided = await act(approver, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    const { application } = (await admin.get(`/applications/${id}`)).body
    expect(application.approvedAmount).toBe(amount)
    expect(application.terms ?? null).toBeNull()
  })
})

describe('a recommendation to decline in a terms or underwriting stage', () => {
  it('is never held by the stage’s work; a recommendation to approve is', async () => {
    const base = legacyToWorkflow({ requireSecondApproval: true })
    const recommend = base.states.find((state) => state.id === 'decision').actions.find((action) => action.kind === 'recommend')
    const definition = {
      ...base,
      legacy: undefined,
      states: base.states.map((state) => (['appraisal', 'in_review'].includes(state.id) ? { ...state, actions: [...state.actions, { ...recommend, id: `${state.id}_recommend` }] } : state)),
    }
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
    expect((await admin.put('/admin/workflow/draft', { definition })).status).toBe(200)
    const published = await admin.post('/admin/workflow/publish', {})
    expect(published.status, JSON.stringify(published.body)).toBe(200)

    const id = await submit('terms-decline-early@example.com')
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    const { workflow } = (await officer.get(`/applications/${id}`)).body
    expect(workflow.actions.find((action) => action.id === 'appraisal_recommend').blocked).toBeNull()
    expect(workflow.actions.find((action) => action.id === 'appraised').blocked).toBe('Moves on once the loan terms are saved.')

    const approve = await act(officer, id, 'transition', { actionId: 'appraisal_recommend', verdict: 'approve', rationale: 'Fine' })
    expect(approve.status).toBe(409)
    expect(approve.body.code).toBe('terms_incomplete')
    const decline = await act(officer, id, 'transition', { actionId: 'appraisal_recommend', verdict: 'decline', rationale: 'Too risky' })
    expect(decline.status, JSON.stringify(decline.body)).toBe(200)

    // In underwriting too: nothing verified, and a decline still goes through.
    const other = await submit('uw-decline-early@example.com')
    for (const [action, extra] of [['start_review', {}], ['save_terms', {}], ['transition', { actionId: 'appraised' }]]) expect((await act(officer, other, action, extra)).status).toBe(200)
    const at = (await officer.get(`/applications/${other}`)).body.workflow
    expect(at.state.work).toBe('underwriting')
    expect(at.actions.find((action) => action.id === 'in_review_recommend').blocked).toBeNull()
    expect(at.actions.find((action) => action.id === 'underwritten').blocked).toMatch(/^Moves on once underwriting is complete/)
    expect((await act(officer, other, 'transition', { actionId: 'in_review_recommend', verdict: 'approve', rationale: 'Fine' })).body.code).toBe('underwriting_incomplete')
    const declined = await act(officer, other, 'transition', { actionId: 'in_review_recommend', verdict: 'decline', rationale: 'Too risky' })
    expect(declined.status, JSON.stringify(declined.body)).toBe(200)
  })
})
