import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { putBlob, readBlob } from './blob.js'
import { sha256 } from './pdf.js'
import { addEvent } from './applications.js'
import { recordAudit } from './audit.js'
import { sendStageDocumentsEmail } from './email.js'
import { ensureOfferDocuments, mergeValuesFor, renderTemplate } from './offerDocuments.js'
import { getPublishedTemplate, listDocumentKinds } from './templates.js'
import { getWorkflowVersion } from './workflowVersions.js'
import { isOfferDocument, stateById, stateDocuments } from '../../src/config/workflow.js'

const { applications, applicationDocuments } = schema

/*
 * Documents a workflow state sends the applicant (src/config/workflow.js → stateDocuments):
 * made from the published templates when a case enters the state, and emailed in one go,
 * the unsigned PDFs attached. The applicant signs each online (signing.js) or prints,
 * signs and uploads it; staff can also mark one received when it comes back on paper.
 *
 * Kept in application_documents, so no table of their own:
 *   the issued copy   source "system", slot stage.{kind} (offer.{kind} for the offer
 *                     letter and agreement), meta { kind, stage, stageLabel, required,
 *                     requiresSignature, sha256, signatureSpots, sentAt, viewedAt,
 *                     receivedAt, receivedBy, receivedByName, receivedNote }
 *   a signed copy     source "system", meta { signed: true, signedFrom: issued id }
 *   an upload         source "signed_copy", meta { kind, uploadFor: issued id }
 *
 * A document is done once it is signed online or marked received. A required one holds
 * the state's forward actions until then (workflow.js).
 */

export const SIGNED_COPY_SOURCE = 'signed_copy'

/** Where a kind's issued copy is kept: the offer documents keep their own slot, so the offer finds them. */
export const slotFor = (kind) => (isOfferDocument(kind) ? `offer.${kind}` : `stage.${kind}`)

const rowsOf = (db, applicationId) =>
  db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.applicationId, applicationId), inArray(applicationDocuments.source, ['system', SIGNED_COPY_SOURCE])))
    .orderBy(asc(applicationDocuments.createdAt))

/**
 * The issued copies among an application's rows: every one made for a stage, and the
 * latest offer letter and agreement (made on approval, before stage documents existed).
 */
const issuedAmong = (rows) => {
  const latestOffer = {}
  for (const row of rows) {
    if (row.source === 'system' && !row.meta?.signed && isOfferDocument(row.meta?.kind)) latestOffer[row.meta.kind] = row
  }
  return rows.filter((row) => row.source === 'system' && !row.meta?.signed && row.meta?.kind && (isOfferDocument(row.meta.kind) ? latestOffer[row.meta.kind] === row : row.meta.stage))
}

/** Where one issued document stands, from the rows around it. */
const describe = (issued, rows) => {
  const meta = issued.meta || {}
  const signed = rows.find((row) => row.meta?.signed && row.meta.signedFrom === issued.id) || null
  const upload = rows.filter((row) => row.source === SIGNED_COPY_SOURCE && row.meta?.uploadFor === issued.id).at(-1) || null
  const status = meta.receivedAt ? 'received' : signed ? 'signed' : upload ? 'uploaded' : meta.viewedAt ? 'viewed' : meta.sentAt ? 'sent' : 'ready'
  return {
    id: issued.id,
    kind: meta.kind,
    label: issued.label,
    filename: issued.filename,
    stage: meta.stage || null,
    stageLabel: meta.stageLabel || null,
    required: Boolean(meta.required),
    // The offer letter and agreement are signed by accepting the offer.
    offer: isOfferDocument(meta.kind),
    requiresSignature: isOfferDocument(meta.kind) || Boolean(meta.requiresSignature),
    status,
    done: status === 'received' || status === 'signed',
    createdAt: issued.createdAt,
    sentAt: meta.sentAt || null,
    viewedAt: meta.viewedAt || null,
    signedDocumentId: signed?.id || null,
    signedAt: signed?.createdAt || null,
    uploadedDocumentId: upload?.id || null,
    uploadedAt: upload?.createdAt || null,
    receivedAt: meta.receivedAt || null,
    receivedByName: meta.receivedByName || null,
    receivedNote: meta.receivedNote || null,
  }
}

/** Every document sent (or ready to send) to the applicant, oldest first, with its status. */
export const stageDocumentsOf = async (applicationId, db = null) => {
  const rows = await rowsOf(db || (await getDb()), applicationId)
  return issuedAmong(rows).map((issued) => describe(issued, rows))
}

/** One issued document of the application, as its row and its status; null when there is no such document. */
export const findStageDocument = async (applicationId, documentId) => {
  const db = await getDb()
  const rows = await rowsOf(db, applicationId)
  const issued = issuedAmong(rows).find((row) => row.id === documentId)
  return issued ? { row: issued, document: describe(issued, rows) } : null
}

/** Merges `changes` into an issued document's meta. */
export const updateDocumentMeta = async (row, changes, db = null) => {
  const [updated] = await (db || (await getDb()))
    .update(applicationDocuments)
    .set({ meta: { ...row.meta, ...changes } })
    .where(eq(applicationDocuments.id, row.id))
    .returning()
  return updated
}

/**
 * The required documents of `state` not yet signed or received, by name. `db` may be the
 * action's transaction, so the kinds (for names of documents never made) are passed in.
 */
export const outstandingDocuments = async (db, application, state, kinds = [], definition = null) => {
  const required = stateDocuments(state, definition).filter((entry) => entry.required)
  if (!required.length) return []
  const documents = await stageDocumentsOf(application.id, db)
  const name = (kind) => kinds.find((entry) => entry.key === kind)?.label || kind
  return required
    .filter((entry) => !documents.some((document) => document.kind === entry.kind && (document.offer || document.stage === state.id) && document.done))
    .map((entry) => documents.find((document) => document.kind === entry.kind)?.label || name(entry.kind))
}

/** Whether the applicant may open this file: a document sent to them, or their signed copy of one. */
export const customerMaySee = async (application, document) => {
  if (document.source !== 'system') return true
  const documents = await stageDocumentsOf(application.id)
  return documents.some((entry) => !entry.offer && (entry.id === document.id || entry.signedDocumentId === document.id))
}

const fileName = (label, reference) => `${label.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}-${reference}.pdf`

/** Makes one document for this application and state from its published template. */
const generate = async (db, application, state, entry, kind, values) => {
  const template = await getPublishedTemplate(kind.key)
  const { bytes, signatureSpots } = await renderTemplate(template, values, { label: kind.label, signature: kind.requiresSignature })
  const filename = fileName(kind.label, application.reference)
  const slot = slotFor(kind.key)
  const stored = await putBlob(`applications/${application.id}/${slot}-${filename}`, Buffer.from(bytes), { contentType: 'application/pdf' })
  const [row] = await db
    .insert(applicationDocuments)
    .values({
      applicationId: application.id,
      slot,
      docType: kind.key,
      label: kind.label,
      pathname: stored.pathname,
      url: stored.url,
      filename,
      contentType: 'application/pdf',
      size: bytes.length,
      source: 'system',
      meta: {
        kind: kind.key,
        stage: state.id,
        stageLabel: state.label,
        required: Boolean(entry.required),
        requiresSignature: Boolean(kind.requiresSignature),
        templateVersion: template.version,
        templateSource: template.source,
        sha256: sha256(bytes),
        signed: false,
        signatureSpots,
      },
    })
    .returning()
  return row
}

// One run per application at a time in this process: an action's background run and a
// "Resend" arriving together must not both make the documents.
const inFlight = new Map()

/**
 * Makes the documents the case's current state sends, where they aren't made yet, and
 * emails the applicant those not yet sent — or, with `resend`, every one not yet done.
 * Never throws for a failed document or email: each failure is noted on the case.
 * Returns { documents, sent, error }.
 */
export const issueStageDocuments = (applicationId, options = {}) => {
  const previous = inFlight.get(applicationId) || Promise.resolve()
  const run = previous.catch(() => {}).then(() => issue(applicationId, options))
  inFlight.set(applicationId, run)
  return run.finally(() => {
    if (inFlight.get(applicationId) === run) inFlight.delete(applicationId)
  })
}

const issue = async (applicationId, { origin = '', actor = null, req = null, resend = false } = {}) => {
  const db = await getDb()
  const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
  if (!application?.workflowVersion) return { documents: [], sent: [] }
  const flow = await getWorkflowVersion(application.workflowVersion)
  const state = stateById(flow.definition, application.state)
  const entries = stateDocuments(state, flow.definition)
  if (!entries.length) return { documents: [], sent: [] }

  const kinds = await listDocumentKinds({ includeRetired: true })
  let values = null
  const made = []
  const issued = []
  for (const entry of entries) {
    const kind = kinds.find((candidate) => candidate.key === entry.kind)
    try {
      if (!kind) throw new Error('this document no longer exists in Settings → Documents')
      const current = await stageDocumentsOf(application.id)
      let found = current.find((document) => document.kind === kind.key && (document.offer || document.stage === state.id))
      if (!found && isOfferDocument(kind.key)) {
        // The offer documents are made on approval; this makes them if that didn't.
        await ensureOfferDocuments(application.id)
        found = (await stageDocumentsOf(application.id)).find((document) => document.kind === kind.key)
        if (!found) throw new Error('it is only made once the loan is approved')
      }
      let row
      if (found) {
        row = (await db.select().from(applicationDocuments).where(eq(applicationDocuments.id, found.id)).limit(1))[0]
        // The offer documents learn the stage that sends them, the first time one does.
        if (!row.meta?.stage) row = await updateDocumentMeta(row, { stage: state.id, stageLabel: state.label, required: Boolean(entry.required) }, db)
      } else {
        values = values || (await mergeValuesFor(application))
        row = await generate(db, application, state, entry, kind, values)
        made.push(row)
      }
      issued.push(row)
    } catch (error) {
      console.warn(`[stage documents] ${entry.kind} for ${application.reference} not made: ${error?.message || error}`)
      await addEvent(db, { applicationId: application.id, actor: null, type: 'document', message: `The ${(kind?.label || entry.kind).toLowerCase()} could not be made: ${error?.message || error}` }).catch(() => {})
    }
  }
  if (made.length) {
    await addEvent(db, { applicationId: application.id, actor: null, type: 'document', message: `Made for the applicant: ${made.map((row) => row.label).join(', ')}` })
    await recordAudit({ req, actor, action: 'application.documents_generated', entityType: 'application', entityId: application.id, detail: { reference: application.reference, documents: made.map((row) => row.meta.kind) } })
  }

  const rows = await rowsOf(db, application.id)
  const toSend = issued.filter((row) => {
    const document = describe(row, rows)
    return resend ? !document.done : !document.sentAt
  })
  if (!toSend.length) return { documents: issued, sent: [] }

  const attachments = []
  for (const row of toSend) {
    const stored = await readBlob(row)
    if (stored) attachments.push({ filename: row.filename, content: Buffer.from(stored.data), contentType: 'application/pdf' })
  }
  const listed = toSend.map((row) => ({ label: row.label, sign: isOfferDocument(row.meta.kind) || Boolean(row.meta.requiresSignature) }))
  try {
    await sendStageDocumentsEmail(application.applicantEmail, { reference: application.reference, documents: listed, url: `${origin}/my-applications`, attachments })
  } catch (error) {
    console.warn(`[stage documents] email for ${application.reference} not sent: ${error?.message || error}`)
    await addEvent(db, { applicationId: application.id, actor: null, type: 'document', message: `The documents email could not be sent: ${error?.message || error}` }).catch(() => {})
    return { documents: issued, sent: [], error: 'The email could not be sent. Try again in a moment.' }
  }
  const now = new Date().toISOString()
  for (const row of toSend) await updateDocumentMeta(row, { sentAt: now, sentCount: (row.meta.sentCount || 0) + 1 }, db)
  await addEvent(db, {
    applicationId: application.id,
    actor,
    type: 'document',
    message: `${resend ? 'Sent again' : 'Sent'} to the applicant${listed.some((entry) => entry.sign) ? ' to sign' : ''}: ${toSend.map((row) => row.label).join(', ')}`,
    visibleToCustomer: true,
  })
  await recordAudit({ req, actor, action: 'application.documents_sent', entityType: 'application', entityId: application.id, detail: { reference: application.reference, documents: toSend.map((row) => row.meta.kind), resend } })
  return { documents: issued, sent: toSend }
}
