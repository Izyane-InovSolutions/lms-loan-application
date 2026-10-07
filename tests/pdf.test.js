import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { signaturePng } from './helpers.js'

const { renderTextTemplate, fillUploadedPdf, signPdf, inspectPdf, sha256 } = await import('../api/_lib/pdf.js')
const { SAMPLE_VALUES, fillPlaceholders, unknownPlaceholders, fieldKeyFor } = await import('../src/config/templates.js')

const pages = async (bytes) => (await PDFDocument.load(bytes)).getPageCount()

/** A lender's own PDF with form fields, as they might upload it. */
const lenderPdf = async (fieldNames) => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const form = doc.getForm()
  fieldNames.forEach((name, index) => form.createTextField(name).addToPage(page, { x: 50, y: 700 - index * 60, width: 250, height: name === 'customer_signature' ? 50 : 20 }))
  return doc.save()
}

describe('templates', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(fillPlaceholders('Dear {{ Customer Name }}, {{amount}} {{nope}}', SAMPLE_VALUES)).toBe('Dear Ada Banda, K10,000.00 {{nope}}')
    expect(unknownPlaceholders('{{amount}} {{nope}} {{Nope}}')).toEqual(['nope'])
    expect(fieldKeyFor('{{ Monthly Instalment }}')).toBe('monthly_instalment')
  })

  it('renders a written template across pages, whatever characters it contains', async () => {
    const body = `Dear {{customer_name}},\n\n## The loan\n- Amount: {{amount}}\n\n${'word '.repeat(900)}\nEmoji 🙂, 中文, “quotes” – dashes.`
    const { bytes } = await renderTextTemplate({ title: 'Loan offer', body, values: SAMPLE_VALUES, footer: 'Loan Origination · LOS-1' })
    expect(await pages(bytes)).toBeGreaterThan(1)
  })
})

describe('letterhead and signature block', () => {
  const letterhead = { name: 'Izyane Finance', logo: { bytes: signaturePng(120, 40), contentType: 'image/png' }, address: 'Plot 1, Cairo Road, Lusaka', contacts: '+260 211 000 000 · loans@example.com', colour: '#1f4e79' }

  it('signs at the end of a template that doesn’t say where, with the letterhead on every page', async () => {
    const body = `Dear {{customer_name}},\n\n${'word '.repeat(900)}`
    const { bytes, signatureSpots } = await renderTextTemplate({ title: 'Loan offer', body, values: SAMPLE_VALUES, footer: 'LOS-1', letterhead })
    const count = await pages(bytes)
    expect(count).toBeGreaterThan(1)
    expect(signatureSpots).toHaveLength(1)
    expect(signatureSpots[0]).toMatchObject({ pageIndex: count - 1, date: expect.any(Object) })
  })

  it('puts the signature where the template has {{customer_signature}}, and draws the date when signed', async () => {
    const body = 'Terms first.\n\n{{customer_signature}}\n\nSchedule after the signature.'
    const rendered = await renderTextTemplate({ title: 'Agreement', body, values: SAMPLE_VALUES, letterhead })
    expect(rendered.signatureSpots).toHaveLength(1)
    expect(rendered.signatureSpots[0].pageIndex).toBe(0)
    const signed = await signPdf(rendered.bytes, { signature: signaturePng(), signatureSpots: rendered.signatureSpots, signedOn: '6 October 2026', record: { signerName: 'Ada Banda', statement: 'Signed', rows: [] } })
    expect(sha256(signed)).not.toBe(sha256(rendered.bytes))
  })

  it('still renders with an unreadable logo, and without a signature when asked', async () => {
    const broken = { ...letterhead, logo: { bytes: Buffer.from('not an image'), contentType: 'image/png' } }
    const { bytes, signatureSpots } = await renderTextTemplate({ title: 'Notice', body: 'Hello', values: SAMPLE_VALUES, letterhead: broken, signature: false })
    expect(await pages(bytes)).toBe(1)
    expect(signatureSpots).toEqual([])
  })
})

describe('uploaded PDFs', () => {
  it('reports its form fields, and refuses what is not a PDF', async () => {
    const { fields } = await inspectPdf(await lenderPdf(['{{customer_name}}', 'Amount', 'customer_signature']))
    expect(fields).toEqual(['{{customer_name}}', 'Amount', 'customer_signature'])
    await expect(inspectPdf(Buffer.from('not a pdf'))).rejects.toThrow(/couldn’t be read/)
  })

  it('fills matching fields, keeps a place for the signature, and flattens the form', async () => {
    const filled = await fillUploadedPdf(await lenderPdf(['{{customer_name}}', 'Amount', 'customer_signature', 'internal_code']), { values: SAMPLE_VALUES })
    expect(filled.filled).toBe(2)
    expect(filled.signatureSpots).toHaveLength(1)
    const doc = await PDFDocument.load(filled.bytes)
    expect(doc.getForm().getFields()).toHaveLength(0)
    expect(doc.getPageCount()).toBe(1)
  })

  it('adds a summary page to a PDF with no fields it knows', async () => {
    const plain = await PDFDocument.create()
    plain.addPage()
    const filled = await fillUploadedPdf(await plain.save(), { values: SAMPLE_VALUES, summary: { title: 'Summary', intro: 'Terms', rows: [['Amount', SAMPLE_VALUES.amount]] } })
    expect(await pages(filled.bytes)).toBe(2)
  })
})

describe('signing', () => {
  it('adds a signature record page and changes the fingerprint', async () => {
    const { bytes, signatureSpots } = await fillUploadedPdf(await lenderPdf(['customer_signature']), { values: SAMPLE_VALUES })
    const signed = await signPdf(bytes, {
      signature: signaturePng(),
      signatureSpots,
      record: { signerName: 'Ada Banda', statement: 'Signed electronically.', rows: [['Fingerprint before signing', sha256(bytes)]] },
    })
    expect(await pages(signed)).toBe(2)
    expect(sha256(signed)).not.toBe(sha256(bytes))
  })
})
