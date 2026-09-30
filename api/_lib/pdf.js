import crypto from 'node:crypto'
import { PDFDocument, PDFTextField, StandardFonts, rgb } from 'pdf-lib'
import { SIGNATURE_FIELD, fieldKeyFor, fillPlaceholders } from '../../src/config/templates.js'

/*
 * The PDFs the workspace makes: offer letters and loan agreements from a written template
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

/** Lays text out top to bottom across as many A4 pages as it needs. */
const createWriter = async (doc) => {
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  }
  const safe = safeFor(fonts.regular)
  const width = A4[0] - MARGIN * 2
  let page = null
  let y = 0

  const newPage = () => {
    page = doc.addPage(A4)
    y = A4[1] - MARGIN
  }
  const ensure = (height) => {
    if (!page || y - height < MARGIN + 24) newPage()
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
export const renderTextTemplate = async ({ title, body, values, footer }) => {
  const doc = await PDFDocument.create()
  doc.setTitle(fillPlaceholders(title, values))
  doc.setProducer('Loan Origination workspace')
  const writer = await createWriter(doc)
  writer.newPage()
  writer.title(fillPlaceholders(title, values))

  let paragraph = []
  const flush = () => {
    if (paragraph.length) writer.paragraph(paragraph.join('\n'), { gap: 8 })
    paragraph = []
  }
  for (const templateLine of String(body || '').split(/\r?\n/)) {
    const line = fillPlaceholders(templateLine, values).trimEnd()
    if (!templateLine.trim()) flush()
    else if (!line.trim()) continue
    else if (line.startsWith('## ')) {
      flush()
      writer.heading(line.slice(3))
    } else if (/^\s*[-*] /.test(line)) {
      flush()
      writer.bullet(line.replace(/^\s*[-*] /, ''))
    } else paragraph.push(line.trim())
  }
  flush()
  addFooters(doc, writer.fonts.regular, footer)
  return { bytes: await doc.save(), signatureSpots: [] }
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
export const signPdf = async (bytes, { signature, record, signatureSpots = [] }) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const png = await doc.embedPng(signature)
  for (const spot of signatureSpots) {
    const page = doc.getPages()[spot.pageIndex]
    if (!page) continue
    const scale = Math.min(spot.width / png.width, spot.height / png.height)
    page.drawImage(png, { x: spot.x, y: spot.y, width: png.width * scale, height: png.height * scale })
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
