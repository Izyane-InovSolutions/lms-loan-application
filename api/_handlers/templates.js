import { fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { putBlob } from '../_lib/blob.js'
import { readSingleUpload } from '../_lib/upload.js'
import { inspectPdf } from '../_lib/pdf.js'
import { lenderName, renderTemplate } from '../_lib/offerDocuments.js'
import { getSetting } from '../_lib/settings.js'
import {
  discardTemplateDraft,
  documentKind,
  getDraftTemplate,
  getPublishedTemplate,
  isPlaceholderTemplate,
  listDocumentKinds,
  publishTemplateDraft,
  saveTemplateDraft,
  templateHistory,
} from '../_lib/templates.js'
import { MERGE_FIELDS, SAMPLE_VALUES, SIGNATURE_FIELD, fieldKeyFor, unknownPlaceholders } from '../../src/config/templates.js'

/*
 * Settings → Documents: the templates of the offer letter, the facility letter and the
 * lender's own document kinds (whose list is the `documents` setting). Admin only
 * (settings.manage). A draft can be previewed with sample values before it is published;
 * only a published version is used for customers.
 */

/** The kind named in the path, as { key, label, requiresSignature, … }; retired kinds too. */
const kindFrom = async (params) => {
  const kind = await documentKind(params.kind)
  if (!kind) fail(404, 'Unknown document.', 'not_found')
  return kind
}

const renderOptions = (kind) => ({ label: kind.label, signature: kind.requiresSignature })

/** What the editor needs about a template, without storage locations. */
const describe = (template, kind) => {
  if (!template) return null
  const { pdfPathname, pdfUrl, ...rest } = template
  const known = template.fields.map((name) => ({ name, key: fieldKeyFor(name) }))
  return {
    ...rest,
    placeholder: isPlaceholderTemplate(template, kind),
    unknownPlaceholders: template.source === 'text' ? unknownPlaceholders(`${template.title}\n${template.body}`) : [],
    recognisedFields: known.filter((field) => field.key === SIGNATURE_FIELD || MERGE_FIELDS.some((entry) => entry.key === field.key)).map((field) => field.name),
    otherFields: known.filter((field) => field.key !== SIGNATURE_FIELD && !MERGE_FIELDS.some((entry) => entry.key === field.key)).map((field) => field.name),
    hasSignatureField: known.some((field) => field.key === SIGNATURE_FIELD),
  }
}

const overview = async (req) => {
  await requireUser(req, { permission: 'settings.manage' })
  const list = await listDocumentKinds({ includeRetired: true })
  const kinds = {}
  for (const kind of list) {
    const [published, draft, history] = await Promise.all([getPublishedTemplate(kind.key), getDraftTemplate(kind.key), templateHistory(kind.key)])
    kinds[kind.key] = { published: describe(published, kind), draft: describe(draft, kind), history }
  }
  // `custom` is the `documents` setting as stored, which the kind editor saves back whole.
  return { kinds, kindList: list, custom: (await getSetting('documents')).kinds, fields: MERGE_FIELDS, signatureField: SIGNATURE_FIELD }
}

/** Saves written wording as the draft. */
const saveText = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const { key: kind, ...meta } = await kindFrom(params)
  const title = text(req.body?.title, 200)
  const body = String(req.body?.body || '').trim().slice(0, 50000)
  if (title.length < 2) fail(400, 'Give the document a title.', 'invalid_input')
  if (body.length < 20) fail(400, 'Write the document’s wording.', 'invalid_input')
  const draft = await saveTemplateDraft(kind, { source: 'text', title, body }, actor)
  await recordAudit({ req, actor, action: 'template.draft_saved', entityType: 'template', entityId: draft.id, detail: { kind, source: 'text' } })
  return { draft: describe(draft, { key: kind, ...meta }) }
}

/** Uploads the lender's own PDF as the draft. */
const upload = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const { key: kind, ...meta } = await kindFrom(params)
  const { fields, file } = await readSingleUpload(req)
  if (file.contentType !== 'application/pdf') fail(400, 'Upload a PDF.', 'invalid_file')
  let inspected
  try {
    inspected = await inspectPdf(file.data)
  } catch (error) {
    fail(400, error.message, 'invalid_file')
  }
  const stored = await putBlob(`templates/${kind}/${Date.now()}-${file.filename}`, file.data, { contentType: 'application/pdf' })
  const draft = await saveTemplateDraft(
    kind,
    { source: 'pdf', title: text(fields.title, 200) || file.filename.replace(/\.pdf$/i, ''), pdfPathname: stored.pathname, pdfUrl: stored.url, pdfFilename: file.filename, fields: inspected.fields },
    actor
  )
  await recordAudit({ req, actor, action: 'template.draft_saved', entityType: 'template', entityId: draft.id, detail: { kind, source: 'pdf', filename: file.filename, fields: inspected.fields.length } })
  return { draft: describe(draft, { key: kind, ...meta }) }
}

const discard = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const { key: kind } = await kindFrom(params)
  const removed = await discardTemplateDraft(kind)
  if (removed) await recordAudit({ req, actor, action: 'template.draft_discarded', entityType: 'template', entityId: removed.id, detail: { kind } })
  return { ok: true }
}

const publish = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const meta = await kindFrom(params)
  const kind = meta.key
  const draft = await getDraftTemplate(kind)
  if (!draft) fail(400, 'There is no draft to publish.', 'no_draft')
  // A draft that can't render must not become what customers get.
  try {
    await renderTemplate(draft, { ...SAMPLE_VALUES, lender_name: await lenderName() }, renderOptions(meta))
  } catch (error) {
    fail(400, `This draft can’t be turned into a PDF: ${error.message}`, 'invalid_template')
  }
  const published = await publishTemplateDraft(kind, actor)
  await recordAudit({ req, actor, action: 'template.published', entityType: 'template', entityId: published.id, detail: { kind, version: published.version } })
  return { published: describe(published, meta) }
}

/** The draft (or published) template filled with sample values, as a PDF. */
const preview = async (req, res, { params, query }) => {
  await requireUser(req, { permission: 'settings.manage' })
  const meta = await kindFrom(params)
  const kind = meta.key
  const template = query.get('version') === 'draft' ? await getDraftTemplate(kind) : await getPublishedTemplate(kind)
  if (!template) fail(404, 'There is no draft to preview.', 'not_found')
  let rendered
  try {
    rendered = await renderTemplate(template, { ...SAMPLE_VALUES, lender_name: await lenderName() }, renderOptions(meta))
  } catch (error) {
    fail(400, error.message, 'invalid_template')
  }
  const data = Buffer.from(rendered.bytes)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${kind}-preview.pdf"`)
  res.setHeader('Content-Length', data.length)
  res.statusCode = 200
  res.end(data)
}

export const templateRoutes = [
  ['GET', '/admin/templates', overview],
  ['PUT', '/admin/templates/:kind/draft', saveText],
  ['POST', '/admin/templates/:kind/upload', upload],
  ['DELETE', '/admin/templates/:kind/draft', discard],
  ['POST', '/admin/templates/:kind/publish', publish],
  ['GET', '/admin/templates/:kind/preview', preview],
]
