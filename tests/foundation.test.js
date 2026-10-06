import crypto from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, emailCode } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { hashPassword, verifyPassword } = await import('../api/_lib/auth/password.js')
const { createRouter, fail } = await import('../api/_lib/http.js')
const { BUILT_IN_ROLES } = await import('../src/config/roles.js')
const can = (role, permission) => BUILT_IN_ROLES[role]?.permissions.includes(permission) || false

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('a long enough passphrase')
    expect(await verifyPassword('a long enough passphrase', hash)).toBe(true)
    expect(await verifyPassword('a long enough passphrasE', hash)).toBe(false)
    expect(await verifyPassword('a long enough passphrase', 'garbage')).toBe(false)
  })

  it('refuses short passwords', async () => {
    await expect(hashPassword('short')).rejects.toMatchObject({ status: 400, code: 'weak_password' })
  })
})

describe('router', () => {
  const router = createRouter([
    ['GET', '/things/:id', (req, res, { params }) => ({ id: params.id })],
    ['POST', '/things', () => fail(409, 'Taken.', 'taken')],
    ['GET', '/boom', () => {
      throw new Error('database password is hunter2')
    }],
  ])
  const call = (method, path, extra = {}) => client(router, extra)[method](path)

  it('matches params, 404s unknown paths and 405s wrong methods', async () => {
    expect((await call('get', '/things/42')).body).toEqual({ id: '42' })
    expect((await call('get', '/nope')).status).toBe(404)
    const wrongMethod = await call('patch', '/things/42')
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.allow).toBe('GET')
  })

  it('returns HttpErrors with their code and hides unexpected ones', async () => {
    expect(await call('post', '/things')).toMatchObject({ status: 409, body: { code: 'taken', message: 'Taken.' } })
    const crash = await call('get', '/boom')
    expect(crash.status).toBe(500)
    expect(JSON.stringify(crash.body)).not.toContain('hunter2')
  })

  it('blocks cross-origin writes', async () => {
    const response = await call('post', '/things', { origin: 'https://evil.example' })
    expect(response).toMatchObject({ status: 403, body: { code: 'cross_origin' } })
  })
})

describe('role permissions', () => {
  it('limits management to admins by default', () => {
    expect(can('admin', 'users.manage')).toBe(true)
    expect(['loan_officer', 'sales_manager', 'rm', 'dsa', 'customer'].some((role) => can(role, 'users.manage'))).toBe(false)
    expect(can('rm', 'users.view')).toBe(true)
    expect(can('dsa', 'users.view')).toBe(false)
    expect(can('sales_manager', 'audit.view')).toBe(false)
  })
})

describe('accounts and visibility (against PGlite)', () => {
  const admin = client(handler)
  const rm = client(handler)
  const dsa = client(handler)
  const officer = client(handler)
  let rmId
  let otherRmId

  beforeAll(async () => {
    expect((await admin.post('/auth/demo', { role: 'admin' })).status).toBe(200)
    rmId = (await rm.post('/auth/demo', { role: 'rm' })).body.user.id
    await dsa.post('/auth/demo', { role: 'dsa' })
    await officer.post('/auth/demo', { role: 'loan_officer' })

    otherRmId = (await admin.post('/users', { name: 'Other Manager', email: 'other.rm@example.com', role: 'rm' })).body.user.id
    await admin.post('/users', { name: 'Team Agent', email: 'team.agent@example.com', role: 'dsa', managerId: rmId })
    await admin.post('/users', { name: 'Stranger Agent', email: 'stranger.agent@example.com', role: 'dsa', managerId: otherRmId })
  })

  it('hands back the invite link only when the email could not be sent', async () => {
    const response = await admin.post('/users', { name: 'New Officer', email: 'new.officer@example.com', role: 'loan_officer' })
    expect(response.status).toBe(200)
    expect(response.body.emailed).toBe(false)
    expect(response.body.inviteUrl).toMatch(/\/admin\/set-password\?token=/)
  })

  it('gives agents and RMs a referral code', async () => {
    const { body } = await admin.get('/users?q=team.agent')
    expect(body.users[0].referralCode).toMatch(/^[A-Z2-9]{8}$/)
  })

  it('shows an RM only themselves and their own agents', async () => {
    const { status, body } = await rm.get('/users')
    expect(status).toBe(200)
    const emails = body.users.map((user) => user.email)
    expect(emails).toContain('team.agent@example.com')
    expect(emails).toContain('demo.dsa@demo.los.local')
    expect(emails).not.toContain('stranger.agent@example.com')
    expect(emails).not.toContain('other.rm@example.com')
  })

  it('refuses the directory to agents and management to everyone but admins', async () => {
    expect((await dsa.get('/users')).status).toBe(403)
    expect((await officer.post('/users', { name: 'X Y', email: 'x@example.com', role: 'dsa' })).status).toBe(403)
    expect((await rm.get('/audit')).status).toBe(403)
  })

  it('only lets an RM manage agents', async () => {
    const response = await admin.post('/users', { name: 'Bad Link', email: 'bad.link@example.com', role: 'dsa', managerId: crypto.randomUUID() })
    expect(response.body.code).toBe('invalid_manager')
  })

  it('signs a disabled account out at once', async () => {
    const victim = client(handler)
    const { body } = await victim.post('/auth/demo', { role: 'sales_manager' })
    expect((await victim.get('/overview')).status).toBe(200)
    await admin.patch(`/users/${body.user.id}`, { status: 'disabled' })
    expect((await victim.get('/overview')).status).toBe(401)
  })

  it('does not let an admin disable or demote themselves', async () => {
    const me = (await admin.get('/auth/me')).body.user
    expect((await admin.patch(`/users/${me.id}`, { status: 'disabled' })).body.code).toBe('self_change')
    expect((await admin.patch(`/users/${me.id}`, { role: 'dsa' })).body.code).toBe('self_change')
  })

  it('records changes in the audit log', async () => {
    const { body } = await admin.get('/audit?action=user.')
    const actions = body.entries.map((entry) => entry.action)
    expect(actions).toContain('user.invited')
    expect(actions).toContain('user.updated')
  })

  it('filters by actor and entity, and rejects a malformed actor id', async () => {
    const me = (await admin.get('/auth/me')).body.user
    const mine = await admin.get(`/audit?actor=${me.id}`)
    expect(mine.status).toBe(200)
    expect(mine.body.entries.every((entry) => entry.actorId === me.id)).toBe(true)
    const none = await admin.get(`/audit?actor=${crypto.randomUUID()}`)
    expect(none.body.entries).toEqual([])
    const user = await admin.get('/audit?entity=user')
    expect(user.body.entries.every((entry) => entry.entityType === 'user')).toBe(true)
    expect((await admin.get('/audit?actor=not-a-uuid')).body.code).toBe('invalid_actor')
  })

  it('treats a bare "to" date as the end of that day', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { body } = await admin.get(`/audit?from=${today}&to=${today}`)
    expect(body.entries.length).toBeGreaterThan(0)
    expect((await admin.get('/audit?to=2000-01-01')).body.entries).toEqual([])
  })

  it('lists actions with counts', async () => {
    const { body } = await admin.get('/audit/actions')
    expect(body.actions.find((row) => row.action === 'user.invited')?.count).toBeGreaterThan(0)
  })
})

describe('customer sign-in', () => {
  it('creates a customer from a valid code and refuses staff emails', async () => {
    const customer = client(handler)
    await emailCode(kv, 'login', 'thandi@example.com', '123456')
    const wrong = await customer.post('/auth/customer', { email: 'thandi@example.com', code: '000000' })
    expect(wrong.status).toBe(400)
    const right = await customer.post('/auth/customer', { email: 'thandi@example.com', code: '123456' })
    expect(right.body.user.role).toBe('customer')
    // A customer session is not a way into the staff workspace.
    expect((await customer.get('/overview')).status).toBe(403)

    await emailCode(kv, 'login', 'demo.admin@demo.los.local', '654321')
    const staff = await client(handler).post('/auth/customer', { email: 'demo.admin@demo.los.local', code: '654321' })
    expect(staff.body.code).toBe('staff_account')
  })
})
