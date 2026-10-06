import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { addressDistance } = await import('../api/_lib/geo.js')

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

/** Submits a personal application whose payslip the AI didn't read. */
const submitUnread = async (email) => {
  const { token, body } = await prepareDraft(email)
  await kv.del(`aiAnalysis:${email}:payslips`)
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}

const caseOf = async (id) => waitFor(async () => (await admin.get(`/applications/${id}`)).body.prescreen && (await admin.get(`/applications/${id}`)).body)
const ruleFor = (body, fact, operator) => body.prescreen.ruleResults.find((result) => result.fact === fact && (!operator || result.operator === operator))

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('location at submission', () => {
  it('is required: a submission without one is refused with a reason', async () => {
    const { token, body } = await prepareDraft('no-location@example.com')
    const { location, ...withoutLocation } = body
    expect(location).toBeTruthy()
    const refused = await applicant.post('/applications', withoutLocation, { authorization: `Bearer ${token}` })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ code: 'location_required' })
    expect(refused.body.message).toMatch(/location/)
  })
})

describe('figures the rules can’t check', () => {
  let id

  it('say why in plain words instead of "not known"', async () => {
    id = await submitUnread('unread-payslip@example.com')
    const body = await caseOf(id)
    const dti = ruleFor(body, 'debt_to_income')
    expect(dti.state).toBe('not_evaluated')
    expect(dti.reason).toMatch(/^The instalment can’t be compared with take-home pay: /)
    expect(dti.reason).toMatch(/payslip/)
    expect(dti.reason).toMatch(/Figures from documents/)
    // The rule that catches unknown net pay says why too.
    expect(ruleFor(body, 'net_monthly_pay', 'missing')).toMatchObject({ state: 'fired', reason: expect.stringMatching(/payslip/) })
    expect(body.prescreen.facts._notes.reasons.net_monthly_pay).toMatch(/payslip/)
  })

  it('can be entered by an officer, who is named, and the rules run again', async () => {
    expect((await applicant.post(`/applications/${id}/figures`, { netPay: 12000 })).status).toBe(401)
    expect((await officer.post(`/applications/${id}/figures`, { netPay: 'lots' })).status).toBe(400)
    const saved = await officer.post(`/applications/${id}/figures`, { netPay: '12,000', note: 'From the August payslip' })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const { prescreen, application } = saved.body
    expect(application.checks.figures.netPay).toMatchObject({ value: 12000, byName: expect.any(String), note: 'From the August payslip' })
    expect(prescreen.facts.net_monthly_pay).toBe(12000)
    expect(prescreen.facts.debt_to_income).toBeCloseTo(application.monthlyInstalment / 12000, 2)
    const dti = prescreen.ruleResults.find((result) => result.fact === 'debt_to_income')
    expect(dti.state).not.toBe('not_evaluated')
    expect(dti.source).toMatch(/^Entered by /)
  })

  it('go back to the AI’s reading when cleared, and only take figures for the loan type', async () => {
    const cleared = await officer.post(`/applications/${id}/figures`, { netPay: null })
    expect(cleared.body.application.checks.figures.netPay).toBeUndefined()
    expect(cleared.body.prescreen.facts.net_monthly_pay).toBeNull()
    // Turnover is a business figure: nothing to save on a personal loan.
    expect((await officer.post(`/applications/${id}/figures`, { annualTurnover: 900000 })).body.code).toBe('nothing_to_save')
  })
})

describe('GPS against the typed home address', () => {
  const application = (residentialAddress) => ({ loanType: 'personal', data: { employmentInfo: { residentialAddress } } })
  const gps = { latitude: -15.4167, longitude: 28.2833, accuracyMeters: 20 }

  // The map service, simulated: a nonsense address isn't found; anything else is in Kabulonga.
  const fakeMap = async (url) => {
    const { pathname, searchParams } = new URL(url)
    const body = pathname.endsWith('/reverse')
      ? { display_name: 'Cairo Road, Lusaka Central, Lusaka, Lusaka District, Lusaka Province, Zambia' }
      : searchParams.get('q') === 'qwertyui'
        ? []
        : [{ lat: '-15.4100', lon: '28.3200', display_name: 'Kabulonga, Lusaka, Lusaka District, Lusaka Province, Zambia' }]
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  it('says where they were, and that the typed address couldn’t be found, when it’s nonsense', async () => {
    vi.stubEnv('GEOCODER', 'nominatim')
    vi.stubGlobal('fetch', fakeMap)
    try {
      const result = await addressDistance(application('qwertyui'), gps)
      expect(result.km).toBeNull()
      expect(result.gps).toMatchObject({ latitude: -15.4167, longitude: 28.2833, accuracy: 20, place: 'Cairo Road, Lusaka Central, Lusaka' })
      expect(result.address).toMatchObject({ typed: 'qwertyui', found: false })
      expect(result.reason).toBe('They submitted from -15.41670, 28.28330 (near Cairo Road, Lusaka Central, Lusaka), but the home address they typed, “qwertyui”, couldn’t be found on the map to compare. Check the address with the applicant.')
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it('measures the distance between the GPS position and a real address', async () => {
    vi.stubEnv('GEOCODER', 'nominatim')
    vi.stubGlobal('fetch', fakeMap)
    try {
      const result = await addressDistance(application('Plot 12, Kabulonga, Lusaka'), gps)
      expect(result.km).toBeGreaterThan(3)
      expect(result.km).toBeLessThan(6)
      expect(result.address).toMatchObject({ found: true, label: 'Kabulonga, Lusaka' })
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
