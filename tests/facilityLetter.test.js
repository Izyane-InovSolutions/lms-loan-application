import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
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

  it('replaces the offer letter’s earlier starting wording, which said “monthly”, with the wording that lists the terms', async () => {
    const db = await getDb()
    const current = await getPublishedTemplate('offer_letter')
    const earlier = current.body
      .replace('- Fees and charges: {{facility_fee}}\n{{charges}}\n', '- Facility fee: {{facility_fee}}\n')
      .replace('- Repayment: {{number_of_instalments}} {{repayment_frequency_lower}} instalments of {{instalment}}\n- Paid out to you after charges: {{net_disbursed}}\n', '- Monthly instalment: {{monthly_instalment}}\n')
    expect(earlier).not.toBe(current.body)
    await db.update(schema.documentTemplates).set({ body: earlier }).where(eq(schema.documentTemplates.id, current.id))
    const upgraded = await getPublishedTemplate('offer_letter')
    expect(upgraded.version).toBe(current.version + 1)
    expect(upgraded.body).toBe(current.body)
    expect(upgraded.body).toMatch(/\{\{number_of_instalments\}\} \{\{repayment_frequency_lower\}\} instalments of \{\{instalment\}\}/)
    expect(isPlaceholderTemplate(upgraded)).toBe(true)
  })

  it('is signed in its acceptance section', async () => {
    const template = await getPublishedTemplate('loan_agreement')
    const { signatureSpots } = await renderTemplate(template, SAMPLE_VALUES)
    expect(signatureSpots).toHaveLength(1)
  })
})
