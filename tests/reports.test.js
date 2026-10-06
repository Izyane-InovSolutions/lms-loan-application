import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { periodRange, isPeriod, periodDates, pastMonths } = await import('../src/config/reportPeriods.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const salesManager = client(handler)
const applicant = client(handler)

/** Invites someone and signs them in with a password, as a real invite would. */
const invitee = async (name, email, role, extra = {}) => {
  const invite = await admin.post('/users', { name, email, role, ...extra })
  expect(invite.status, JSON.stringify(invite.body)).toBe(200)
  const person = client(handler)
  const token = decodeURIComponent(invite.body.inviteUrl.split('token=')[1])
  await person.post('/auth/password/set', { token, password: `${email}-password` })
  return { person, id: invite.body.user.id }
}

/** An application brought in through an agent's referral link. */
const referred = async (agent, email) => {
  const code = (await agent.get('/auth/me')).body.user.referralCode
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', { ...body, referralCode: code }, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}

const report = async (who, period = '30') => (await who.get(`/reports/agents?period=${period}`))
const rowFor = (body, id) => body.agents.find((agent) => agent.id === id)

let rm
let mine
let other
let older

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await salesManager.post('/auth/demo', { role: 'sales_manager' })
  rm = await invitee('Rita Manager', 'rita.rm@example.com', 'rm')
  mine = await invitee('Dan Agent', 'dan.dsa@example.com', 'dsa', { managerId: rm.id })
  other = await invitee('Olive Elsewhere', 'olive.dsa@example.com', 'dsa')

  await referred(mine.person, 'dan.customer1@example.com')
  older = await referred(mine.person, 'dan.customer2@example.com')
  await referred(other.person, 'olive.customer@example.com')
  // One of Dan's is from 45 days ago: in the 60- and 90-day figures, not the 30-day ones.
  const db = await getDb()
  await db.update(schema.applications).set({ submittedAt: new Date(Date.now() - 45 * 86400000) }).where(eq(schema.applications.id, older))
})

describe('agent performance', () => {
  it('shows a sales manager or administrator every agent', async () => {
    for (const who of [salesManager, admin]) {
      const { status, body } = await report(who, '90')
      expect(status, JSON.stringify(body)).toBe(200)
      expect(body.scope).toBe('all')
      expect(rowFor(body, mine.id)).toMatchObject({ name: 'Dan Agent', submitted: 2, open: 2, managerName: 'Rita Manager' })
      expect(rowFor(body, other.id)).toMatchObject({ submitted: 1, managerName: null })
      // Relationship managers lead teams; they aren't listed as agents.
      expect(rowFor(body, rm.id)).toBeUndefined()
    }
  })

  it('shows a relationship manager only the agents who report to them', async () => {
    const { body } = await report(rm.person, '90')
    expect(body.scope).toBe('team')
    expect(body.agents.map((agent) => agent.id)).toEqual([mine.id])
    expect(body.totals).toMatchObject({ agents: 1, active: 1, submitted: 2, open: 2 })
  })

  it('counts by period: 30, 60 and 90 days, and all time', async () => {
    const counts = {}
    for (const period of ['30', '60', '90', 'all']) counts[period] = rowFor((await report(salesManager, period)).body, mine.id).submitted
    expect(counts).toEqual({ 30: 1, 60: 2, 90: 2, all: 2 })
    expect((await report(salesManager, '45')).status).toBe(400)
    expect((await report(salesManager, 'month:2999-01')).status).toBe(400)
    expect((await salesManager.get('/reports/agents')).body).toMatchObject({ period: 'this-month', label: 'This month' })
  })

  it('shows one agent’s figures for every period side by side, with what they have on now', async () => {
    const { status, body } = await salesManager.get(`/reports/agents/${mine.id}`)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.agent).toMatchObject({ id: mine.id, name: 'Dan Agent', managerName: 'Rita Manager', drafts: 0 })
    const byPeriod = Object.fromEntries(body.periods.map((column) => [column.period, column]))
    expect(body.periods.map((column) => column.period)).toEqual(['this-month', 'last-month', '30', '60', '90', 'all'])
    expect([30, 60, 90, 'all'].map((period) => byPeriod[period].submitted)).toEqual([1, 2, 2, 2])
    expect(byPeriod.all).toMatchObject({ personal: 2, business: 0, label: 'All time', dates: null })
    expect(byPeriod['30'].dates).toMatch(/ – /)
    expect(body.agent).toMatchObject({ open: 2 })
    // A past month chosen on the list comes first.
    const withMonth = (await salesManager.get(`/reports/agents/${mine.id}?period=month:2026-01`)).body
    expect(withMonth.periods[0]).toMatchObject({ period: 'month:2026-01', label: 'January 2026' })
    // Last month picked by name isn't shown twice.
    const [[lastMonth]] = pastMonths(1)
    expect((await salesManager.get(`/reports/agents/${mine.id}?period=${lastMonth}`)).body.periods).toHaveLength(6)
    expect(body.recent).toHaveLength(2)
  })

  it('opens an agent only for whoever may see them, and never says whether one exists otherwise', async () => {
    expect((await rm.person.get(`/reports/agents/${mine.id}`)).status).toBe(200)
    expect((await rm.person.get(`/reports/agents/${other.id}`)).status).toBe(404)
    // A relationship manager isn't an agent, so has no page here.
    expect((await salesManager.get(`/reports/agents/${rm.id}`)).status).toBe(404)
    expect((await salesManager.get('/reports/agents/not-an-id')).status).toBe(404)
    expect((await mine.person.get(`/reports/agents/${mine.id}`)).status).toBe(403)
  })

  it('counts a payout when it was paid out, and a decision when it was made, not when the application came in', async () => {
    // Dan's older application, submitted 45 days ago, was approved yesterday and paid out today.
    const db = await getDb()
    const yesterday = new Date(Date.now() - 86400000)
    await db.update(schema.applications).set({ status: 'disbursed', decidedAt: yesterday, approvedAmount: 4000 }).where(eq(schema.applications.id, older))
    const { addEvent } = await import('../api/_lib/applications.js')
    await addEvent(db, { applicationId: older, actor: null, type: 'status', toStatus: 'disbursed', message: 'Paid out' })
    const thirty = rowFor((await report(salesManager, '30')).body, mine.id)
    expect(thirty).toMatchObject({ submitted: 1, approved: 1, disbursed: 1, disbursedValue: 4000 })
    // Open is as of now: one of the two is still being worked.
    expect(thirty.open).toBe(1)
  })

  it('is not for agents themselves', async () => {
    expect((await report(mine.person)).status).toBe(403)
  })
})

describe('report periods', () => {
  // 00:30 on 7 October 2026 in Lusaka is still 6 October in UTC.
  const now = new Date('2026-10-06T22:30:00Z')
  const iso = ({ from, to }) => [from?.toISOString() ?? null, to?.toISOString() ?? null]

  it('follow the Lusaka calendar, from midnight to midnight', () => {
    expect(iso(periodRange('this-month', now))).toEqual(['2026-09-30T22:00:00.000Z', '2026-10-07T22:00:00.000Z'])
    expect(iso(periodRange('last-month', now))).toEqual(['2026-08-31T22:00:00.000Z', '2026-09-30T22:00:00.000Z'])
    // 30 days is 8 September to 7 October, today included.
    expect(iso(periodRange('30', now))).toEqual(['2026-09-07T22:00:00.000Z', '2026-10-07T22:00:00.000Z'])
    expect(iso(periodRange('month:2026-02', now))).toEqual(['2026-01-31T22:00:00.000Z', '2026-02-28T22:00:00.000Z'])
    expect(iso(periodRange('all', now))).toEqual([null, null])
    expect(periodDates('last-month', now)).toBe('1 Sept – 30 Sept 2026')
  })

  it('accept past and current months only', () => {
    expect(isPeriod('month:2026-10', now)).toBe(true)
    expect(isPeriod('month:2026-11', now)).toBe(false)
    expect(isPeriod('month:2026-13', now)).toBe(false)
    expect(isPeriod('45', now)).toBe(false)
  })
})
