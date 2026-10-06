import crypto from 'node:crypto'
import { PDFDocument, PDFTextField, StandardFonts, rgb } from 'pdf-lib'
import { SIGNATURE_FIELD, fieldKeyFor, fillPlaceholders } from '../../src/config/templates.js'
import { DEFAULT_BRAND_NAME } from '../../src/config/branding.js'

/*
 * The PDFs the workspace makes: offer letters and facility letters from a written template
 * or an uploaded PDF, and the signature page added when the customer signs. Pure
 * JavaScript (pdf-lib), so it runs the same on Vercel and a plain Node server.
 *
 * Only the standard PDF fonts are used, which cover Western European text. Anything they
 * cannot draw is replaced rather than failing the whole document.
 */

const A4 = [595.28, 841.89]
const MARGIN = 56
const INK = rgb(0.1, 0.13, 0.18)
const MUTED = rgb(0.4, 0.45, 0.52)
const RULE = rgb(0.85, 0.87, 0.9)

export const sha256 = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')

const SUBSTITUTES = { ' ': ' ', '‑': '-', '−': '-', '\t': '    ' }

/** A function that makes text safe for a standard font. */
const safeFor = (font) => {
  const cache = new Map()
  return (text) =>
    [...String(text ?? '')]
      .map((char) => {
        if (char === '\n') return char
        if (!cache.has(char)) {
          const candidate = SUBSTITUTES[char] ?? char
          try {
            font.encodeText(candidate)
            cache.set(char, candidate)
          } catch {
            cache.set(char, '?')
          }
        }
        return cache.get(char)
      })
      .join('')
}

// Room kept at the top and bottom of each page for the letterhead.
const HEADER_SPACE = 74
const FOOTER_SPACE = 22

/** Lays text out top to bottom across as many A4 pages as it needs. `letterhead` keeps room for one. */
const createWriter = async (doc, { letterhead = false } = {}) => {
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  }
  const safe = safeFor(fonts.regular)
  const width = A4[0] - MARGIN * 2
  let page = null
  let y = 0

  const top = letterhead ? HEADER_SPACE : 0
  const bottom = MARGIN + 24 + (letterhead ? FOOTER_SPACE : 0)
  const newPage = () => {
    page = doc.addPage(A4)
    y = A4[1] - MARGIN - top
  }
  const ensure = (height) => {
    if (!page || y - height < bottom) newPage()
  }

  const wrap = (text, font, size, maxWidth) => {
    const lines = []
    for (const raw of safe(text).split('\n')) {
      let line = ''
      for (const word of raw.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next
        else {
          if (line) lines.push(line)
          // A single word longer than the line is broken where it must be.
          let rest = word
          while (font.widthOfTextAtSize(rest, size) > maxWidth) {
            let cut = rest.length - 1
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1
            lines.push(rest.slice(0, cut))
            rest = rest.slice(cut)
          }
          line = rest
        }
      }
      lines.push(line)
    }
    return lines
  }

  const text = (value, { font = fonts.regular, size = 10.5, color = INK, indent = 0, gap = 6, leading = 1.4 } = {}) => {
    const lines = wrap(value, font, size, width - indent)
    for (const line of lines) {
      ensure(size * leading)
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color })
      y -= size * leading
    }
    y -= gap
  }

  return {
    fonts,
    safe,
    width,
    get page() {
      return page
    },
    get y() {
      return y
    },
    newPage,
    ensure,
    space: (height) => {
      y -= height
    },
    title: (value) => text(value, { font: fonts.bold, size: 17, gap: 10 }),
    heading: (value) => {
      ensure(40)
      y -= 6
      text(value, { font: fonts.bold, size: 12, gap: 4 })
    },
    paragraph: (value, options) => text(value, options),
    bullet: (value) => {
      ensure(16)
      page.drawText('•', { x: MARGIN + 4, y: y - 10.5, size: 10.5, font: fonts.regular, color: INK })
      text(value, { indent: 16, gap: 3 })
    },
    rule: () => {
      ensure(12)
      page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: MARGIN + width, y: y - 4 }, thickness: 0.75, color: RULE })
      y -= 14
    },
    /** Label and value side by side, the value wrapping in its own column. */
    rows: (entries, { labelWidth = 150 } = {}) => {
      for (const [label, value] of entries) {
        const labelLines = wrap(label, fonts.bold, 10, labelWidth - 12)
        const lines = wrap(value || '—', fonts.regular, 10, width - labelWidth)
        const height = 14 * Math.max(lines.length, labelLines.length)
        ensure(height + 4)
        labelLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - 10 - index * 14, size: 10, font: fonts.bold, color: MUTED }))
        lines.forEach((line, index) => page.drawText(line, { x: MARGIN + labelWidth, y: y - 10 - index * 14, size: 10, font: fonts.regular, color: INK }))
        y -= height + 5
      }
      y -= 4
    },
    /**
     * Where the customer signs: a box for the signature with their name under it, and a
     * date line filled in when they sign. Returns the spot signPdf draws into.
     */
    signatureBlock: ({ heading = 'Signed by the borrower', name }) => {
      ensure(132)
      y -= 8
      page.drawText(safe(heading), { x: MARGIN, y: y - 11, size: 11, font: fonts.bold, color: INK })
      y -= 24
      const box = { width: 220, height: 64 }
      const boxBottom = y - box.height
      page.drawRectangle({ x: MARGIN, y: boxBottom, ...box, borderColor: RULE, borderWidth: 0.75, borderDashArray: [3, 3] })
      page.drawText('Signature', { x: MARGIN + 6, y: boxBottom + 6, size: 7, font: fonts.regular, color: MUTED })
      const dateX = MARGIN + box.width + 40
      page.drawLine({ start: { x: dateX, y: boxBottom }, end: { x: dateX + 150, y: boxBottom }, thickness: 0.75, color: RULE })
      page.drawText('Date', { x: dateX, y: boxBottom - 11, size: 8, font: fonts.regular, color: MUTED })
      page.drawText(safe(name || ''), { x: MARGIN, y: boxBottom - 14, size: 10, font: fonts.bold, color: INK })
      y = boxBottom - 30
      const pageIndex = doc.getPages().indexOf(page)
      return { pageIndex, x: MARGIN + 4, y: boxBottom + 4, width: box.width - 8, height: box.height - 8, date: { x: dateX, y: boxBottom + 5 } }
    },
    image: async (png, { maxWidth = 220, maxHeight = 80 } = {}) => {
      const embedded = await doc.embedPng(png)
      const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height, 1)
      const drawn = { width: embedded.width * scale, height: embedded.height * scale }
      ensure(drawn.height + 8)
      page.drawImage(embedded, { x: MARGIN, y: y - drawn.height, ...drawn })
      y -= drawn.height + 8
    },
  }
}

/** A brand colour from Settings → Branding ("#1f4e79"), or the default ink. */
const colourOf = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!match) return INK
  const value = parseInt(match[1], 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

/**
 * The lender's letterhead on every page: logo and name at the top left, address and
 * contacts at the top right, a band of the brand colour under it, and a thinner one above
 * the footer. `letterhead` is { name, logo: { bytes, contentType } | null, address, contacts, colour }.
 */
const addLetterhead = async (doc, fonts, letterhead) => {
  const colour = colourOf(letterhead.colour)
  const safe = safeFor(fonts.regular)
  let logo = null
  if (letterhead.logo?.bytes) {
    try {
      logo = letterhead.logo.contentType === 'image/jpeg' ? await doc.embedJpg(letterhead.logo.bytes) : await doc.embedPng(letterhead.logo.bytes)
    } catch {
      logo = null // An unreadable logo leaves the name on its own rather than failing the document.
    }
  }
  const [width, height] = A4
  const top = height - MARGIN + 18
  const right = width - MARGIN
  const contactLines = [letterhead.address, letterhead.contacts].map((line) => safe(line || '').trim()).filter(Boolean)
  for (const page of doc.getPages()) {
    let nameX = MARGIN
    if (logo) {
      const scale = Math.min(40 / logo.height, 120 / logo.width)
      page.drawImage(logo, { x: MARGIN, y: top - 40, width: logo.width * scale, height: logo.height * scale })
      nameX = MARGIN + logo.width * scale + 10
    }
    page.drawText(safe(letterhead.name || ''), { x: nameX, y: top - 25, size: 14, font: fonts.bold, color: colour })
    contactLines.forEach((line, index) => {
      const size = 8
      page.drawText(line, { x: right - fonts.regular.widthOfTextAtSize(line, size), y: top - 12 - index * 11, size, font: fonts.regular, color: MUTED })
    })
    page.drawRectangle({ x: MARGIN, y: top - 52, width: width - MARGIN * 2, height: 3, color: colour })
    page.drawRectangle({ x: MARGIN, y: MARGIN / 2 + 14, width: width - MARGIN * 2, height: 1, color: colour })
  }
}

/** Reference and page numbers along the foot of every page. */
const addFooters = (doc, font, label) => {
  const pages = doc.getPages()
  const safe = safeFor(font)
  pages.forEach((page, index) => {
    const line = safe(`${label ? `${label}   ·   ` : ''}Page ${index + 1} of ${pages.length}`)
    page.drawText(line, { x: MARGIN, y: MARGIN / 2, size: 8, font, color: MUTED })
  })
}

/**
 * A written template as a PDF. The body is plain text laid out as typed: each line on its
 * own line, a blank line between paragraphs, "## " for a heading and "- " for a bullet.
 * {{fields}} are filled from `values`; a line left empty by its fields (a company name on
 * a personal loan) is dropped rather than leaving a gap.
 */
export const renderTextTemplate = async ({ title, body, values, footer, letterhead = null, signature = true, producer = `${DEFAULT_BRAND_NAME} workspace` }) => {
  const doc = await PDFDocument.create()
  doc.setTitle(fillPlaceholders(title, values))
  doc.setProducer(producer)
  const writer = await createWriter(doc, { letterhead: Boolean(letterhead) })
  writer.newPage()
  writer.title(fillPlaceholders(title, values))
  const signatureSpots = []
  const signatureName = [values.customer_name, values.company_name && `for ${values.company_name}`].filter(Boolean).join(' ')

  let paragraph = []
  const flush = () => {
    if (paragraph.length) writer.paragraph(paragraph.join('\n'), { gap: 8 })
    paragraph = []
  }
  for (const templateLine of String(body || '').split(/\r?\n/)) {
    // A line holding only {{customer_signature}} is where the borrower signs.
    if (templateLine.trim() === `{{${SIGNATURE_FIELD}}}`) {
      flush()
      signatureSpots.push(writer.signatureBlock({ name: signatureName }))
      continue
    }
    const line = fillPlaceholders(templateLine, values).trimEnd()
    // Headings and bullets come from how the template is written, never from a filled-in
    // value (an applicant naming themselves "## Clause 9").
    if (!templateLine.trim()) flush()
    else if (!line.trim()) continue
    else if (templateLine.startsWith('## ')) {
      flush()
      writer.heading(line.slice(3))
    } else if (/^\s*[-*] /.test(templateLine)) {
      flush()
      writer.bullet(line.replace(/^\s*[-*] /, ''))
    } else paragraph.push(line.trim())
  }
  flush()
  // A template that doesn't say where to sign is signed at the end.
  if (signature && !signatureSpots.length) signatureSpots.push(writer.signatureBlock({ name: signatureName }))
  if (letterhead) await addLetterhead(doc, writer.fonts, letterhead)
  addFooters(doc, writer.fonts.regular, footer)
  return { bytes: await doc.save(), signatureSpots }
}

/** The form fields in an uploaded PDF, by name. Throws when the file isn't a usable PDF. */
export const inspectPdf = async (bytes) => {
  let doc
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error) {
    throw new Error(/encrypt/i.test(error?.message || '') ? 'This PDF is password-protected. Upload a copy without a password.' : 'This file couldn’t be read as a PDF.')
  }
  const names = doc.getForm().getFields().map((field) => field.getName())
  return { pages: doc.getPageCount(), fields: names }
}

/** Where a form field's boxes are, page by page, so the signature can be drawn there later. */
const spotsOf = (doc, field) => {
  const pages = doc.getPages()
  return field.acroField.getWidgets().map((widget) => {
    const rect = widget.getRectangle()
    const pageRef = widget.P()
    const pageIndex = Math.max(0, pages.findIndex((page) => page.ref === pageRef))
    return { pageIndex, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}

/**
 * An uploaded PDF filled in: text fields named like merge fields get their value, a
 * "customer_signature" field is kept as a place to draw the signature, and the form is
 * flattened. A PDF with no fields we recognise gets a summary page of the offer instead.
 */
export const fillUploadedPdf = async (bytes, { values, summary, footer }) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const safe = safeFor(font)
  let filled = 0
  let signatureSpots = []
  for (const field of form.getFields()) {
    const key = fieldKeyFor(field.getName())
    if (key === SIGNATURE_FIELD) {
      signatureSpots = [...signatureSpots, ...spotsOf(doc, field)]
      continue
    }
    if (field instanceof PDFTextField && Object.prototype.hasOwnProperty.call(values, key)) {
      field.setText(safe(values[key] ?? ''))
      field.updateAppearances(font)
      filled += 1
    }
  }
  for (const field of form.getFields().filter((entry) => fieldKeyFor(entry.getName()) === SIGNATURE_FIELD)) form.removeField(field)
  form.flatten()

  if (!filled && summary) {
    const writer = await createWriter(doc)
    writer.newPage()
    writer.title(summary.title)
    writer.paragraph(summary.intro, { color: MUTED })
    writer.rows(summary.rows)
    if (footer) writer.paragraph(footer, { size: 8, color: MUTED })
  }
  // The lender's own pages keep their own footers.
  return { bytes: await doc.save(), signatureSpots, filled }
}

/**
 * A signed copy: the signature drawn wherever the document has a place for it, and a
 * signature record page at the end saying who signed, when, how it was confirmed, and the
 * SHA-256 of the document they saw.
 */
export const signPdf = async (bytes, { signature, record, signatureSpots = [], signedOn = '' }) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const png = await doc.embedPng(signature)
  const dateFont = await doc.embedFont(StandardFonts.Helvetica)
  for (const spot of signatureSpots) {
    const page = doc.getPages()[spot.pageIndex]
    if (!page) continue
    const scale = Math.min(spot.width / png.width, spot.height / png.height)
    page.drawImage(png, { x: spot.x, y: spot.y, width: png.width * scale, height: png.height * scale })
    // Signature blocks the workspace drew have a date line beside the box.
    if (spot.date && signedOn) page.drawText(safeFor(dateFont)(signedOn), { x: spot.date.x, y: spot.date.y, size: 10, font: dateFont, color: INK })
  }

  const writer = await createWriter(doc)
  writer.newPage()
  writer.title('Signature record')
  writer.paragraph(record.statement, { color: MUTED })
  writer.space(4)
  await writer.image(signature)
  writer.paragraph(record.signerName, { font: writer.fonts.bold, gap: 10 })
  writer.rule()
  writer.rows(record.rows, { labelWidth: 170 })
  return doc.save()
}
