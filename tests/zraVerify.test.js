import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
const lookupMock = vi.fn()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
vi.mock('../api/_lib/zra/config.js', () => ({
  getZraConfig: vi.fn(async () => ({
    source: 'environment',
    config: { baseUrl: 'https://zws.test', apiKey: 'test-api-key', username: 'test-user', password: 'test-password' },
  })),
}))
vi.mock('../api/_lib/zra/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createZraClient: vi.fn(() => ({ lookup: lookupMock })),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { ZraError } = await import('../api/_lib/zra/client.js')
const { findFormMismatches } = await import('../src/utils/documentChecks.js')
const { expectedFor } = await import('../api/_lib/prescreen/facts.js')

const prepareDraft = draftPreparer(kv, putBlob)
const applicant = client(handler)
const admin = client(handler)

const waitFor = async (check, attempts = 60) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting')
}

/** Submits a personal application as the wizard does, with the TPIN certificate's AI reading. */
const submit = async (email, { tpinOnCertificate } = {}) => {
  const { token, body } = await prepareDraft(email)
  if (tpinOnCertificate) {
    // Kept only for the very file uploaded, so it carries that file's name and size.
    const { size } = (await kv.get(`draft:${email}`)).documents['personal.documents.tpin']
    await kv.set(`aiAnalysis:${email}:tpin`, {
      analysis: { docType: 'tpin', matchesExpectedType: true, legibility: 'clear', extracted: { holderName: 'Ada Banda', tpinNumber: tpinOnCertificate }, issues: [], authenticityConcerns: [] },
      filename: 'tpin.pdf',
      size,
    })
  }
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}

const zraOf = (id) => waitFor(async () => (await admin.get(`/applications/${id}`)).body.application?.checks?.zra)

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
})

describe('ZRA check after submission', () => {
  it('looks a personal applicant up by NRC only, and keeps the result for staff', async () => {
    lookupMock.mockResolvedValueOnce({ found: true, taxpayer: { tpin: '1000000001', name: 'ADA BANDA' } })
    const id = await submit('zra-ok@example.com', { tpinOnCertificate: '1000000001' })
    const zra = await zraOf(id)
    expect(lookupMock).toHaveBeenLastCalledWith('NRC', '123456/78/9')
    expect(zra).toMatchObject({ status: 'verified', lookupType: 'NRC', tpin: '1000000001', nameMatches: true, documentMismatches: [] })
  })

  it('flags a TPIN certificate that is not the one ZRA holds', async () => {
    lookupMock.mockResolvedValueOnce({ found: true, taxpayer: { tpin: '1000000001', name: 'Ada Banda' } })
    const id = await submit('zra-doc@example.com', { tpinOnCertificate: '2000000002' })
    const zra = await zraOf(id)
    expect(zra.status).toBe('mismatch')
    expect(zra.documentMismatches).toEqual([expect.objectContaining({ slot: 'tpin', tpin: '2000000002' })])
  })

  it('records a missing taxpayer, and an unreachable ZRA, without failing the submission', async () => {
    lookupMock.mockResolvedValueOnce({ found: false })
    expect((await zraOf(await submit('zra-missing@example.com'))).status).toBe('not_found')

    lookupMock.mockRejectedValueOnce(new ZraError('timed out', 'zra_timeout'))
    expect(await zraOf(await submit('zra-down@example.com'))).toMatchObject({ status: 'unavailable', reason: 'zra_timeout' })
  })
})

describe('TPIN on business tax documents', () => {
  it('compares the TPIN printed on ZRA documents with the one entered', () => {
    const data = { businessInfo: { companyName: 'Lusaka Fresh Foods Ltd', tpin: '1000000001' } }
    const expected = expectedFor('business', data, 'taxClearance')
    expect(expected.tpin).toBe('1000000001')
    expect(expectedFor('business', data, 'pacraCertificate').tpin).toBeUndefined()

    const analysis = (tpinNumber) => ({ extracted: { companyName: 'Lusaka Fresh Foods Limited', tpinNumber } })
    expect(findFormMismatches(analysis('1000-000-001'), expected)).toEqual([])
    expect(findFormMismatches(analysis('2000000002'), expected)).toEqual([expect.stringContaining('TPIN on this document (2000000002)')])
  })
})
