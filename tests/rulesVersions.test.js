import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client } from './helpers.js'

vi.mock('../api/_lib/kv.js', () => ({ default: createMemoryKv() }))

const { default: handler } = await import('../api/v1/[...path].js')

describe('rules versions and restore', () => {
  const admin = client(handler)
  const officer = client(handler)
  const anon = client(handler)

  beforeAll(async () => {
    await admin.post('/auth/demo', { role: 'admin' })
    await officer.post('/auth/demo', { role: 'loan_officer' })
  })

  it('lists versions for people who can view rules, not anonymous callers', async () => {
    await admin.get('/rules')
    expect((await anon.get('/rules/versions')).status).toBe(401)
    const { status, body } = await officer.get('/rules/versions')
    expect(status).toBe(200)
    expect(body.versions[0]).toMatchObject({ version: 1, status: 'published' })
    expect(Array.isArray(body.versions[0].policies)).toBe(true)
  })

  it('restores an earlier version as a draft, audited, without publishing', async () => {
    const { body: current } = await admin.get('/rules')
    const original = current.published.policies
    const changed = original.map((policy, index) => (index === 0 ? { ...policy, name: 'Renamed policy' } : policy))
    await admin.put('/rules/draft', { policies: changed, note: 'rename' })
    const published = await admin.post('/rules/publish', {})
    const newest = published.body.published.version

    const restored = await admin.post('/rules/restore', { version: 1 })
    expect(restored.status).toBe(200)
    expect(restored.body.draft.policies[0].name).toBe(original[0].name)
    expect(restored.body.draft.note).toBe('Restored from version 1')

    const after = await admin.get('/rules')
    expect(after.body.published.version).toBe(newest)
    expect(after.body.draft.policies[0].name).toBe(original[0].name)

    const versions = await admin.get('/rules/versions')
    expect(versions.body.versions.map((v) => v.version)).toContain(1)

    const audit = await admin.get('/audit?limit=50')
    expect(audit.status).toBe(200)
    expect(JSON.stringify(audit.body)).toContain('rules.version_restored')
  })

  it('refuses restore without permission, bad input and unknown versions', async () => {
    expect((await officer.post('/rules/restore', { version: 1 })).status).toBe(403)
    expect((await admin.post('/rules/restore', {})).body.code).toBe('invalid_version')
    expect((await admin.post('/rules/restore', { version: 999 })).status).toBe(404)
  })
})
