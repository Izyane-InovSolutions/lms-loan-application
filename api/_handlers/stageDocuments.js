import { getDb, schema } from '../_lib/db/client.js'
import { appOrigin, fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { putBlob } from '../_lib/blob.js'
import { readSingleUpload } from '../_lib/upload.js'
import { afterResponse } from '../_lib/after.js'
import { addEvent, findVisibleApplication } from '../_lib/applications.js'
import { checkOtp, consumeOtp } from '../_lib/otp.js'
import { parseSignature, signStageDocument } from '../_lib/signing.js'
import { creditStaffIds, notifyUsers } from '../_lib/notify.js'
import { SIGNED_COPY_SOURCE, findStageDocument, issueStageDocuments, slotFor, updateDocumentMeta } from '../_lib/stageDocuments.js'
import { loadCase } from './applications.js'

const { applicationDocuments } = schema

/*
 * Documents sent to the applicant at a workflow stage (stageDocuments.js): the applicant
 * signs each online or uploads a signed copy; staff send them again, and mark one received
 * once a signed copy is checked or a paper one handed in (cases.work).
 */

// Nothing more is collected on a case that has ended this way.
const CLOSED_STATUSES = ['declined', 'withdrawn', 'expired']

// A scan or a photo of the signed page.
const SIGNED_COPY_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

/** The document the path names, for the customer to act on: theirs, still open, and not the offer's. */
const openDocumentFor = async (application, documentId) => {
  const found = await findStageDocument(application.id, documentId)
  if (!found) fail(404, 'Document not found.', 'not_found')
  if (found.document.offer) fail(409, 'You sign this when you accept your offer.', 'invalid_state')
  if (CLOSED_STATUSES.includes(application.status)) fail(409, 'This application is closed.', 'invalid_state')
  if (found.document.done) fail(409, 'We already have this document signed.', 'already_done')
  return found
}

/** Tells whoever works the case that the applicant sent something back. */
const tellStaff = (req, application, title, body) =>
  afterResponse('staff notifications', async () =>
    notifyUsers(application.assignedOfficer ? [application.assignedOfficer] : await creditStaffIds(), { type: 'customer_replied', title, body, applicationId: application.id }, { origin: appOrigin(req) })
  )

// ---------------------------------------------------------------------------
// The applicant
// ---------------------------------------------------------------------------

/** Signs one document online: a drawn or typed signature, confirmed with an emailed code. */
const signDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  const { row, document } = await openDocumentFor(application, params.documentId)
  if (!document.requiresSignature) fail(409, 'This document doesn’t need your signature.', 'invalid_state')
  if (req.body?.agreed !== true) fail(400, `Confirm that you have read the ${document.label.toLowerCase()}.`, 'agreement_required')
  const signature = parseSignature(req.body?.signature)
  const code = text(req.body?.code, 12)
  if (!code) fail(400, 'Enter the code we emailed you.', 'code_required')
  const otpError = await checkOtp({ email: application.applicantEmail, code, purpose: 'sign', req })
  if (otpError) fail(otpError.status, otpError.message, 'invalid_code')

  const signed = await signStageDocument({ application, original: row, signature, req })
  await consumeOtp('sign', application.applicantEmail)
  const db = await getDb()
  await addEvent(db, { applicationId: application.id, actor: viewer, type: 'document', message: `${document.label} signed by ${signed.signerName}`, visibleToCustomer: true })
  await recordAudit({ req, actor: viewer, action: 'application.document_signed', entityType: 'application', entityId: application.id, detail: { reference: application.reference, kind: document.kind, signature: signed.id } })
  tellStaff(req, application, `${application.reference}: ${document.label.toLowerCase()} signed`, 'Signed online by the applicant.')
  return { ok: true }
}

/** A signed copy the applicant printed, signed and scanned (or photographed), for staff to check. */
const uploadSignedCopy = async (req, res, { params }) => {
  const viewer = await requireUser(req, { roles: ['customer'] })
  const application = await findVisibleApplication(viewer, params.id)
  const { document } = await openDocumentFor(application, params.documentId)
  if (!document.requiresSignature) fail(409, 'This document doesn’t need your signature.', 'invalid_state')
  const { file } = await readSingleUpload(req)
  if (!SIGNED_COPY_TYPES.includes(file.contentType)) fail(400, 'Upload the signed copy as a PDF, JPG or PNG.', 'unsupported_type')
  const db = await getDb()
  const slot = `${slotFor(document.kind)}.upload`
  const stored = await putBlob(`applications/${application.id}/${slot}-${Date.now()}-${file.filename}`, file.data, { contentType: file.contentType })
  await db.insert(applicationDocuments).values({
    applicationId: application.id,
    slot: `${slot}.${Date.now()}`,
    docType: `${document.kind}_signed_copy`,
    label: `${document.label} (signed copy)`,
    pathname: stored.pathname,
    url: stored.url,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    source: SIGNED_COPY_SOURCE,
    uploadedBy: viewer.id,
    meta: { kind: document.kind, uploadFor: document.id },
  })
  await addEvent(db, { applicationId: application.id, actor: viewer, type: 'document', message: `Sent a signed copy of the ${document.label.toLowerCase()}`, visibleToCustomer: true })
  await recordAudit({ req, actor: viewer, action: 'application.document_uploaded', entityType: 'application', entityId: application.id, detail: { reference: application.reference, kind: document.kind, filename: file.filename } })
  tellStaff(req, application, `${application.reference}: signed ${document.label.toLowerCase()} to check`, 'The applicant uploaded a signed copy. Check it and mark it received.')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/** Sends the current stage's documents again (making any that are missing): every one not yet signed or received. */
const resend = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'cases.work' })
  const application = await findVisibleApplication(viewer, params.id)
  if (CLOSED_STATUSES.includes(application.status)) fail(409, 'This case is closed.', 'invalid_state')
  const result = await issueStageDocuments(application.id, { origin: appOrigin(req), actor: viewer, req, resend: true })
  if (result.error) fail(502, result.error, 'email_failed')
  if (!result.documents.length) fail(409, 'This stage doesn’t send the applicant any documents.', 'no_documents')
  if (!result.sent.length) fail(409, 'Every document at this stage is already signed or received.', 'nothing_to_send')
  return loadCase(application.id, viewer)
}

/** Records that a document came back signed: an uploaded copy checked, or a paper one handed in. */
const markReceived = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'cases.work' })
  const application = await findVisibleApplication(viewer, params.id)
  const found = await findStageDocument(application.id, params.documentId)
  if (!found) fail(404, 'Document not found.', 'not_found')
  if (found.document.done) fail(409, found.document.status === 'signed' ? 'This document is already signed online.' : 'This document is already marked received.', 'already_done')
  const note = text(req.body?.note, 300)
  const how = found.document.uploadedDocumentId ? 'the uploaded copy checked' : 'a paper copy'
  await updateDocumentMeta(found.row, { receivedAt: new Date().toISOString(), receivedBy: viewer.id, receivedByName: viewer.name, receivedNote: note || null })
  const db = await getDb()
  await addEvent(db, {
    applicationId: application.id,
    actor: viewer,
    type: 'document',
    message: `${found.document.label} received (${how})${note ? `: ${note}` : ''}`,
    detail: { customerMessage: `We received your signed ${found.document.label.toLowerCase()}.` },
    visibleToCustomer: true,
  })
  await recordAudit({ req, actor: viewer, action: 'application.document_received', entityType: 'application', entityId: application.id, detail: { reference: application.reference, kind: found.document.kind, uploaded: Boolean(found.document.uploadedDocumentId), note: note || null } })
  return loadCase(application.id, viewer)
}

export const stageDocumentRoutes = [
  ['POST', '/applications/:id/stage-documents/send', resend],
  ['POST', '/applications/:id/stage-documents/:documentId/received', markReceived],
  ['POST', '/me/applications/:id/stage-documents/:documentId/sign', signDocument],
  ['POST', '/me/applications/:id/stage-documents/:documentId/upload', uploadSignedCopy],
]
