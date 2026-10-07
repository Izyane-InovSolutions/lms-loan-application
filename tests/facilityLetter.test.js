import { describe, expect, it, vi } from 'vitest'
import { createMemoryKv } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { getDb, schema } = await import('../api/_lib/db/client.js')
const { getPublishedTemplate, isPlaceholderTemplate, templateHistory, LEGACY_LOAN_AGREEMENT_BODY } = await import('../api/_lib/templates.js')
const { renderTemplate } = await import('../api/_lib/offerDocuments.js')
const { SAMPLE_VALUES, TEMPLATE_KINDS } = await import('../src/config/templates.js')

describe('the facility letter', () => {
  it('replaces the loan agreement’s old starting wording as a new version, keeping the old one', async () => {
    const db = await getDb()
    await db.insert(schema.documentTemplates).values({ kind: 'loan_agreement', version: 1, status: 'published', source: 'text', title: 'Loan agreement', body: LEGACY_LOAN_AGREEMENT_BODY, publishedAt: new Date() })

    const [first, second] = await Promise.all([getPublishedTemplate('loan_agreement'), getPublishedTemplate('loan_agreement')])
    expect(first.title).toBe('Facility letter')
    expect(first.version).toBe(2)
    expect(second.id).toBe(first.id)
    expect(isPlaceholderTemplate(first)).toBe(true)
    expect((await templateHistory('loan_agreement')).map((row) => [row.version, row.status])).toEqual(expect.arrayContaining([[1, 'retired'], [2, 'published']]))
    expect(TEMPLATE_KINDS.loan_agreement.label).toBe('Facility letter')
  })

  it('is signed in its acceptance section', async () => {
    const template = await getPublishedTemplate('loan_agreement')
    const { signatureSpots } = await renderTemplate(template, SAMPLE_VALUES)
    expect(signatureSpots).toHaveLength(1)
  })
})
