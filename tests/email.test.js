import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryKv } from './helpers.js'

const kv = createMemoryKv()
const sent = []
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message)
      },
    }),
  },
}))

const email = await import('../api/_lib/email.js')
const { setSetting } = await import('../api/_lib/settings.js')

const last = () => sent.at(-1)

beforeEach(() => {
  sent.length = 0
})

describe('emails', () => {
  it('carry the brand: logo inline, colour, name and contacts in the footer', async () => {
    await setSetting('branding', { name: 'Izyane Finance', colour: '#0f766e', address: 'Plot 1, Cairo Road, Lusaka', phone: '+260 211 000 000' }, null)
    await email.sendOtpEmail('ada@example.com', '123456', { purpose: 'login' })
    const message = last()
    expect(message.html).toContain('Izyane Finance')
    expect(message.html).toContain('#0f766e')
    expect(message.html).toContain('Plot 1, Cairo Road, Lusaka')
    expect(message.html).toContain('cid:brand-logo')
    expect(message.attachments).toEqual([expect.objectContaining({ cid: 'brand-logo', contentType: 'image/png' })])
    // The plain-text version is still sent, for clients that don't show HTML.
    expect(message.text).toContain('123456')
  })

  it('shows a code large and selectable, with a do-not-share warning', async () => {
    await email.sendOtpEmail('ada@example.com', '654321', { purpose: 'sign' })
    expect(last().subject).toBe('Your code to sign your loan documents')
    expect(last().html).toMatch(/class="code"[^>]*>654321</)
    expect(last().html).toContain('don’t share the code')
  })

  it('gives every link a button and a copyable fallback, and escapes what applicants typed', async () => {
    await email.sendApplicationUpdateEmail('ada@example.com', { reference: 'LOS-2026-000001', headline: 'Your loan is approved', body: 'Approved for <script>alert(1)</script>', url: 'https://loans.example.com/my?x=1&y=2' })
    const { html } = last()
    expect(html).toContain('href="https://loans.example.com/my?x=1&amp;y=2"')
    expect(html).toContain('See your application')
    expect(html).toContain('Button not working?')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('lists stage documents with what to do, keeping the PDFs attached beside the logo', async () => {
    const pdf = { filename: 'facility-letter.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }
    await email.sendStageDocumentsEmail('ada@example.com', { reference: 'LOS-2026-000001', documents: [{ label: 'Facility letter', sign: true }, { label: 'Key facts', sign: false }], url: 'https://loans.example.com/my', attachments: [pdf] })
    const message = last()
    expect(message.subject).toBe('Documents to sign for LOS-2026-000001')
    expect(message.html).toContain('To sign')
    expect(message.html).toContain('To keep')
    expect(message.attachments.map((file) => file.filename)).toEqual(['facility-letter.pdf', 'logo.png'])
  })

  it('sends every kind of email', async () => {
    await email.sendPasswordLinkEmail('new@example.com', { name: 'Mwila', url: 'https://w.example.com/set', purpose: 'invite', invitedBy: 'Natasha', roleLabel: 'Loan officer' })
    await email.sendStaffNotificationEmail('staff@example.com', { name: 'Mwila', title: 'New application LOS-1', body: 'Ada Banda, K5,000', url: 'https://w.example.com/a/1' })
    await email.sendDraftReminderEmail('ada@example.com', { name: 'Ada', product: 'personal loan', url: 'https://loans.example.com', staffName: 'Mwila' })
    for (const purpose of ['offer', 'consent', 'resume']) await email.sendOtpEmail('ada@example.com', '111222', { purpose, agentName: 'Mwila' })
    expect(sent).toHaveLength(6)
    for (const message of sent) {
      expect(message.html).toMatch(/^<!doctype html>/)
      expect(message.text.length).toBeGreaterThan(10)
    }
    expect(sent[0].html).toContain('Loan officer')
  })
})

describe('logo backgrounds', () => {
  it('tells a see-through PNG from a solid one, and never guesses on a JPEG', async () => {
    const fs = await import('node:fs')
    const { PNG } = await import('pngjs')
    const { hasTransparentBackground } = await import('../api/_lib/imageAlpha.js')
    const solid = new PNG({ width: 8, height: 8 })
    solid.data.fill(255)
    const clear = new PNG({ width: 8, height: 8 })
    clear.data.fill(0)
    expect(hasTransparentBackground(PNG.sync.write(solid))).toBe(false)
    expect(hasTransparentBackground(PNG.sync.write(clear))).toBe(true)
    expect(hasTransparentBackground(fs.readFileSync('src/assets/Icon.png'))).toBe(true)
    expect(hasTransparentBackground(Buffer.from('not an image'))).toBe(false)
    expect(hasTransparentBackground(PNG.sync.write(clear), 'image/jpeg')).toBe(false)
  })

  it('leaves a see-through logo off the white tile', async () => {
    await email.sendOtpEmail('ada@example.com', '123456', { purpose: 'login' })
    const logos = last().html.match(/<img src="cid:brand-logo"[^>]*>/g)
    expect(logos.length).toBe(2)
    for (const tag of logos) expect(tag).not.toContain('background:#ffffff')
  })
})
