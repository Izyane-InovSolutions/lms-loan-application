import crypto from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { evaluateRules, DEFAULT_RULES } = await import('../src/config/creditRules.js')

const prepareDraft = draftPreparer(kv, putBlob)

const waitFor = async (check, attempts = 50) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting')
}

describe('credit rules', () => {
  it('refers a high debt-to-income, declines under-age, and passes a clean case', () => {
    const clean = { debt_to_income: 0.2, net_monthly_pay: 9000, applicant_age: 30, documents_wrong_type: 0, location_provided: true }
    expect(evaluateRules(DEFAULT_RULES, clean, 'personal').outcome).toBe('pass')
    expect(evaluateRules(DEFAULT_RULES, { ...clean, debt_to_income: 0.55 }, 'personal').outcome).toBe('refer')
    expect(evaluateRules(DEFAULT_RULES, { ...clean, applicant_age: 17 }, 'personal').outcome).toBe('decline')
    // Unknown net pay is itself a concern, not a silent pass.
    expect(evaluateRules(DEFAULT_RULES, { ...clean, net_monthly_pay: null, debt_to_income: null }, 'personal').outcome).toBe('refer')
  })
})

describe('application lifecycle', () => {
  const applicant = client(handler)
  const admin = client(handler)
  const officer = client(handler)
  const secondOfficer = client(handler)
  const dsa = client(handler)
  const rm = client(handler)
  let applicationId
  let reference
  let adminId
  let officerId
  let secondOfficerId

  beforeAll(async () => {
    adminId = (await admin.post('/auth/demo', { role: 'admin' })).body.user.id
    officerId = (await officer.post('/auth/demo', { role: 'loan_officer' })).body.user.id
    await dsa.post('/auth/demo', { role: 'dsa' })
    await rm.post('/auth/demo', { role: 'rm' })
    const invite = await admin.post('/users', { name: 'Second Officer', email: 'second.officer@example.com', role: 'loan_officer' })
    secondOfficerId = invite.body.user.id
    const token = decodeURIComponent(invite.body.inviteUrl.split('token=')[1])
    await secondOfficer.post('/auth/password/set', { token, password: 'second-officer-pass' })
  })

  it('refuses a submission whose documents are not all uploaded', async () => {
    const { token, body } = await prepareDraft('missing@example.com', { withNrc: false })
    body.data.personalInfo.email = 'missing@example.com'
    const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('missing_documents')
    expect(response.body.message).toContain('NRC copy')
  })

  it('files an application once, even when the submit is retried', async () => {
    const { token, body } = await prepareDraft('ada@example.com')
    const first = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(first.status).toBe(200)
    expect(first.body.reference).toMatch(/^LOS-\d{4}-\d{6}$/)
    applicationId = first.body.id
    reference = first.body.reference

    // The draft token was used up by the first submit; the key alone finds the application.
    await kv.set(`draftToken:${token}`, 'ada@example.com')
    const retry = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(retry.body).toMatchObject({ id: applicationId, duplicate: true })
  })

  it('prescreens with the server’s own document analysis', async () => {
    const detail = await waitFor(async () => {
      const response = await officer.get(`/applications/${applicationId}`)
      return response.body.prescreen ? response.body : null
    })
    expect(detail.prescreen.facts.net_monthly_pay).toBe(10000)
    expect(detail.prescreen.facts.location_provided).toBe(true)
    expect(detail.prescreen.rulesetVersion).toBe(1)
    expect(detail.consents.map((consent) => consent.type).sort()).toEqual(['crb', 'data_processing', 'location'])
    expect(detail.documents).toHaveLength(5)
    // Storage URLs never reach the browser.
    expect(JSON.stringify(detail.documents)).not.toContain('url')
  })

  it('limits assignment and taking cases to each officer’s amount band', async () => {
    const tooHigh = await admin.patch(`/users/${officerId}`, { approvalMin: 6000 })
    expect(tooHigh.status).toBe(200)
    let version = (await officer.get(`/applications/${applicationId}`)).body.application.version
    const cannotTake = await officer.post(`/applications/${applicationId}/actions`, { action: 'start_review', version })
    expect(cannotTake.body.code).toBe('outside_approval_range')
    await admin.patch(`/users/${officerId}`, { approvalMin: 0 })

    const { token, body } = await prepareDraft('assignment-limits@example.com')
    body.data.personalInfo.email = 'assignment-limits@example.com'
    const { body: submitted } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    version = (await admin.get(`/applications/${submitted.id}`)).body.application.version
    await admin.patch(`/users/${adminId}`, { approvalMin: 6000 })
    const adminOutsideRange = await admin.post(`/applications/${submitted.id}/actions`, { action: 'assign', officerId: adminId, version })
    expect(adminOutsideRange.body.code).toBe('outside_approval_range')
    await admin.patch(`/users/${adminId}`, { approvalMin: 0 })
    const secondUser = { id: secondOfficerId }

    await admin.patch(`/users/${secondUser.id}`, { approvalMin: 6000, approvalMax: 7000 })
    const belowMinimum = await admin.post(`/applications/${submitted.id}/actions`, { action: 'assign', officerId: secondUser.id, version })
    expect(belowMinimum.body.code).toBe('outside_approval_range')
    await admin.patch(`/users/${secondUser.id}`, { approvalMin: 0, approvalMax: 4000 })
    const aboveMaximum = await admin.post(`/applications/${submitted.id}/actions`, { action: 'assign', officerId: secondUser.id, version })
    expect(aboveMaximum.body.code).toBe('outside_approval_range')

    await admin.patch(`/users/${secondUser.id}`, { approvalMin: 4000, approvalMax: 6000 })
    const officersResponse = await admin.get('/officers')
    expect(officersResponse.status).toBe(200)
    expect(officersResponse.body).toHaveProperty('officers')
    expect(officersResponse.body.officers.find((person) => person.id === secondUser.id)).toMatchObject({ approvalMin: 4000, approvalMax: 6000 })
    const assigned = await admin.post(`/applications/${submitted.id}/actions`, { action: 'assign', officerId: secondUser.id, version })
    expect(assigned.status).toBe(200)
    expect(assigned.body.application.assignedOfficer).toBe(secondUser.id)
  })

  it('serves documents to staff who may see the case and hides the case from others', async () => {
    const { body } = await officer.get(`/applications/${applicationId}`)
    const document = body.documents[0]
    const file = await officer.get(`/applications/${applicationId}/documents/${document.id}`)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    // Self-service, so not the agent's or RM's case.
    expect((await dsa.get(`/applications/${applicationId}`)).status).toBe(404)
    expect((await dsa.get(`/applications/${applicationId}/documents/${document.id}`)).status).toBe(404)
    expect((await rm.get('/applications')).body.applications).toHaveLength(0)
  })

  it('credits referred applications to the agent and their RM', async () => {
    const { token, body } = await prepareDraft('referred@example.com')
    body.data.personalInfo.email = 'referred@example.com'
    body.referralCode = 'demodsa'
    const submitted = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(submitted.status).toBe(200)
    const forAgent = await dsa.get('/applications')
    expect(forAgent.body.applications.map((row) => row.reference)).toContain(submitted.body.reference)
    expect(forAgent.body.applications[0].channel).toBe('dsa')
    const forRm = await rm.get('/applications')
    expect(forRm.body.applications.map((row) => row.reference)).toContain(submitted.body.reference)
  })

  it('runs the appraisal with four-eyes and a version check', async () => {
    let case_ = (await officer.get(`/applications/${applicationId}`)).body.application
    const act = async (who, action, extra = {}) => {
      const response = await who.post(`/applications/${applicationId}/actions`, { action, version: case_.version, ...extra })
      if (response.status === 200) case_ = response.body.application
      return response
    }

    expect((await act(officer, 'start_review')).status).toBe(200)
    expect(case_.status).toBe('in_review')

    // A stale screen cannot overwrite newer work.
    const stale = await officer.post(`/applications/${applicationId}/actions`, { action: 'note', message: 'late', version: case_.version - 1 })
    expect(stale.body.code).toBe('stale')

    // Approval needs the checklist first.
    expect((await act(officer, 'recommend', { verdict: 'approve', rationale: 'Looks good' })).body.code).toBe('checks_incomplete')
    for (const check of ['identity', 'documents', 'income']) {
      expect((await act(officer, 'check', { check, done: true, note: 'Seen original' })).status).toBe(200)
    }
    expect((await act(officer, 'recommend', { verdict: 'approve', rationale: 'Affordable', amount: 4500 })).status).toBe(200)
    expect(case_.status).toBe('pending_approval')

    // The recommender cannot also decide.
    expect((await act(officer, 'decide', { verdict: 'approve', rationale: 'Me again' })).body.code).toBe('four_eyes')
    await admin.patch(`/users/${adminId}`, { approvalMin: 5000 })
    const adminUnderLimit = await act(admin, 'decide', { verdict: 'approve', rationale: 'Agree' })
    expect(adminUnderLimit.body.code).toBe('under_limit')
    await admin.patch(`/users/${adminId}`, { approvalMin: 0, approvalMax: 4000 })
    const adminOverLimit = await act(admin, 'decide', { verdict: 'approve', rationale: 'Agree' })
    expect(adminOverLimit.body.code).toBe('over_limit')
    await admin.patch(`/users/${adminId}`, { approvalMax: 5000 })
    const decided = await act(admin, 'decide', { verdict: 'approve', rationale: 'Agree' })
    expect(decided.status).toBe(200)
    expect(case_.status).toBe('approved')
    expect(case_.approvedAmount).toBe(4500)
    expect(decided.body.appraisals.map((row) => row.kind)).toEqual(['decision', 'recommendation'])
    await admin.patch(`/users/${adminId}`, { approvalMax: null })
  })

  it('lets the customer answer an information request and keeps internal wording private', async () => {
    const { token, body } = await prepareDraft('bo@example.com')
    body.data.personalInfo.email = 'bo@example.com'
    const { body: submitted } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    let version = (await officer.get(`/applications/${submitted.id}`)).body.application.version
    const act = async (payload) => {
      const response = await officer.post(`/applications/${submitted.id}/actions`, { version, ...payload })
      version = response.body.application?.version ?? version
      return response
    }
    await act({ action: 'start_review' })
    await act({ action: 'request_info', message: 'Please send a clearer NRC copy.' })

    const customer = client(handler)
    await kv.set('otp:bo@example.com', { code: '111222', attempts: 0, createdAt: Date.now() }, { ex: 600 })
    await customer.post('/auth/customer', { email: 'bo@example.com', code: '111222' })
    const mine = await customer.get('/me/applications')
    expect(mine.body.applications.map((row) => row.reference)).toEqual([submitted.reference])
    expect(mine.body.applications[0].infoRequest.message).toContain('clearer NRC')
    // Someone else's application is invisible to this customer.
    expect((await customer.get(`/me/applications/${applicationId}`)).status).toBe(404)

    const reply = await customer.post(`/me/applications/${submitted.id}/respond`, { message: 'Attached a new scan.' })
    expect(reply.status).toBe(200)
    const after = (await officer.get(`/applications/${submitted.id}`)).body.application
    expect(after.status).toBe('in_review')

    version = after.version
    await act({ action: 'recommend', verdict: 'decline', rationale: 'Internal: suspected fake payslip' })
    const approver = client(handler)
    await approver.post('/auth/demo', { role: 'admin' })
    await approver.post(`/applications/${submitted.id}/actions`, { action: 'decide', verdict: 'decline', rationale: 'Internal: agree, fake payslip', version })
    const view = await customer.get(`/me/applications/${submitted.id}`)
    expect(view.body.application.statusLabel).toBe('Not approved')
    expect(JSON.stringify(view.body)).not.toContain('fake payslip')
  })

  it('holds officers to their approval limit', async () => {
    await admin.patch(`/users/${officerId}`, { approvalMin: 0, approvalMax: 3000 })
    await admin.put('/settings/workflow', { requireSecondApproval: false, slaDays: 3 })
    const { token, body } = await prepareDraft('limit@example.com')
    body.data.personalInfo.email = 'limit@example.com'
    body.loanData.amount = 3000
    const { body: submitted } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    let version = (await officer.get(`/applications/${submitted.id}`)).body.application.version
    const act = async (payload) => {
      const response = await officer.post(`/applications/${submitted.id}/actions`, { version, ...payload })
      version = response.body.application?.version ?? version
      return response
    }
    await act({ action: 'start_review' })
    for (const check of ['identity', 'documents', 'income']) await act({ action: 'check', check, done: true, note: 'Seen original' })
    const over = await act({ action: 'recommend', verdict: 'approve', rationale: 'Fine', amount: 5000 })
    expect(over.body.code).toBe('over_limit')
    const within = await act({ action: 'recommend', verdict: 'approve', rationale: 'Fine', amount: 3000 })
    expect(within.body.application.status).toBe('approved')
    await admin.patch(`/users/${officerId}`, { approvalMin: 0, approvalMax: null })
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3 })
  })

  it('pulls a sample credit report only with consent, and re-prescreens', async () => {
    // Without the applicant's consent, no bureau check.
    const { token, body } = await prepareDraft('noconsent@example.com')
    body.data.personalInfo.email = 'noconsent@example.com'
    body.consents = { dataProcessing: true }
    const { body: withoutConsent } = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect((await officer.post(`/applications/${withoutConsent.id}/crb`)).body.code).toBe('no_consent')

    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.status).toBe(200)
    expect(response.body.crbReports[0].report.sample).toBe(true)
    expect(response.body.prescreen.facts.crb_score).toBe(response.body.crbReports[0].score)
  })

  it('edits, simulates and publishes policy rules', async () => {
    const { body: current } = await admin.get('/rules')
    // Policies group the rules; tighten the debt-to-income rule wherever it lives.
    const tighten = (policies) =>
      policies.map((policy) => ({ ...policy, rules: policy.rules.map((rule) => (rule.fact === 'debt_to_income' ? { ...rule, value: 0.01 } : rule)) }))
    const tightened = tighten(current.published.policies)
    expect(current.published.policies.some((policy) => policy.rules.some((rule) => rule.fact === 'debt_to_income'))).toBe(true)
    const simulation = await admin.post('/rules/simulate', { policies: tightened })
    expect(simulation.status).toBe(200)
    expect(simulation.body.proposed.refer).toBeGreaterThanOrEqual(simulation.body.current.refer)
    expect((await officer.put('/rules/draft', { policies: tightened })).status).toBe(403)
    expect((await admin.put('/rules/draft', { policies: [{ name: 'Broken', product: 'personal', rules: [{ fact: 'nope' }] }] })).body.code).toBe('invalid_rules')
    expect((await admin.put('/rules/draft', { policies: tightened, note: 'Tighter DTI' })).status).toBe(200)
    const published = await admin.post('/rules/publish', {})
    expect(published.body.published.version).toBe(2)
  })

  it('reports dashboards per role', async () => {
    const forAdmin = await admin.get('/dashboard?days=30')
    expect(forAdmin.body.kpis.current.submitted).toBeGreaterThanOrEqual(4)
    expect(forAdmin.body.queue).toBeDefined()
    const forAgent = await dsa.get('/dashboard')
    expect(forAgent.body.kpis.current.submitted).toBe(1)
    expect(forAgent.body.recent).toHaveLength(1)
  })

  it('shows staff their referral banner and never leaks the full name', async () => {
    const { body } = await client(handler).get('/referrals/DEMODSA')
    expect(body.referrer).toEqual({ firstName: 'Kelvin', role: 'dsa', roleLabel: 'Direct sales agent', code: 'DEMODSA' })
  })

  it('seeds and clears sample data', async () => {
    const seeded = await admin.post('/demo/seed', { count: 12 })
    expect(seeded.body.created).toBe(12)
    const list = await admin.get('/applications?pageSize=200')
    expect(list.body.total).toBeGreaterThanOrEqual(12)
    const cleared = await admin.post('/demo/clear', {})
    expect(cleared.body.removed).toBe(12)
  })

  it('records the case reference in the audit log', async () => {
    const { body } = await admin.get('/audit?action=application.')
    expect(body.entries.some((entry) => entry.detail?.reference === reference)).toBe(true)
  })
})
