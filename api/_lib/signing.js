import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text, clientIp } from './http.js'
import { deleteBlobs, putBlob, readBlob } from './blob.js'
import { sha256, signPdf } from './pdf.js'
import { ensureOfferDocuments } from './offerDocuments.js'
import { TEMPLATE_KINDS, TEMPLATE_KIND_KEYS } from '../../src/config/templates.js'
import { sealKey } from './secrets.js'

const { applicationDocuments, signatures } = schema

/*
 * The customer's signature on their offer (Settings → Credit workflow → "Accepting means
 * signing"). They read the offer letter and agreement, sign by drawing or typing, and
 * confirm with a code emailed to them. Each document gets a signed copy — the signature
 * drawn in its place and a signature record page added — and the `signatures` row keeps
 * who, when, how, from where, and the SHA-256 of each document before and after.
 */

const MAX_IMAGE_BYTES = 300 * 1024
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** Checks what the browser sent: { name, method: drawn|typed, image: PNG data URL }. */
export const parseSignature = (input) => {
  const name = text(input?.name, 100)
  if (name.length < 3) fail(400, 'Type your full name as your signature.', 'signature_required')
  const method = input?.method === 'typed' ? 'typed' : 'drawn'
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(input?.image || ''))
  if (!match) fail(400, 'Sign in the box first.', 'signature_required')
  const png = Buffer.from(match[1], 'base64')
  if (png.length > MAX_IMAGE_BYTES || !png.subarray(0, 4).equals(PNG_MAGIC)) fail(400, 'That signature could not be read. Clear it and sign again.', 'invalid_signature')
  return { name, method, png, dataUrl: `data:image/png;base64,${match[1]}` }
}

/*
 * The seal: an HMAC over what the record asserts — who signed what, when, how, and the
 * fingerprint of every document before and after. The hashes alone only prove anything
 * while the database is trusted; the seal's key lives in the environment instead.
 */
const sealedFields = (row) =>
  JSON.stringify([
    row.id,
    row.applicationId,
    row.signerName,
    row.signerEmail,
    row.method,
    Boolean(row.codeVerified),
    row.capturedBy ?? null,
    row.ip ?? null,
    new Date(row.signedAt).toISOString(),
    crypto.createHash('sha256').update(String(row.image || '')).digest('hex'),
    (row.documents || []).map((entry) => [entry.kind, entry.documentId, entry.sha256, entry.signedDocumentId, entry.signedSha256]),
  ])

const sealOf = (row) => {
  const key = sealKey('signature')
  return key ? crypto.createHmac('sha256', key).update(sealedFields(row)).digest('hex') : null
}

/** True when the record still matches its seal, false when it doesn't, null when it was never sealed. */
export const verifySeal = (row) => {
  if (!row?.seal) return null
  const expected = sealOf(row)
  if (!expected) return null
  const given = Buffer.from(String(row.seal))
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), given)
}

const lusakaTime = (date) =>
  `${date.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Africa/Lusaka' })} (Lusaka), ${date.toISOString()}`

/**
 * Signs every offer document of an application, before the acceptance is recorded (never
 * inside its transaction). `capturedBy` is the staff member present for an in-person
 * acceptance. Returns the signature row.
 */
export const signOfferDocuments = async ({ application, signature, req, capturedBy = null, codeVerified = true }) => {
  const db = await getDb()
  const docs = await ensureOfferDocuments(application.id)
  const missing = TEMPLATE_KIND_KEYS.filter((kind) => !docs[kind]?.unsigned)
  if (missing.length) fail(503, 'Your offer documents aren’t ready yet. Please try again in a minute.', 'documents_not_ready')

  const id = crypto.randomUUID()
  const signedAt = new Date()
  const ip = clientIp(req)
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300)
  const recorded = []

  for (const kind of TEMPLATE_KIND_KEYS) {
    const original = docs[kind].unsigned
    const stored = await readBlob(original)
    if (!stored) fail(410, `The ${TEMPLATE_KINDS[kind].label.toLowerCase()} is missing from storage. Ask us to reissue your offer.`, 'gone')
    const before = sha256(stored.data)
    // What they sign must be the very file they were shown.
    if (original.meta?.sha256 && before !== original.meta.sha256) fail(409, `The ${TEMPLATE_KINDS[kind].label.toLowerCase()} has changed since it was issued. Ask us to reissue your offer.`, 'document_changed')

    const label = TEMPLATE_KINDS[kind].label
    const rows = [
      ['Document', `${label}, ${application.reference}`],
      ['Signed by', signature.name],
      ['Email', application.applicantEmail],
      ['Signed at', lusakaTime(signedAt)],
      ['How', signature.method === 'typed' ? 'Typed their name as their signature' : 'Drew their signature on screen'],
      ['Confirmed with', codeVerified ? `A one-time code emailed to ${application.applicantEmail}` : 'Not confirmed by code'],
      ...(capturedBy ? [['In person with', `${capturedBy.name} (staff)`]] : []),
      ['IP address', ip || 'unknown'],
      ['Device', userAgent || 'unknown'],
      ['Fingerprint before signing (SHA-256)', before],
      ['Template version', String(original.meta?.templateVersion ?? '')],
      ['Signature record', id],
    ]
    const signedBytes = await signPdf(stored.data, {
      signature: signature.png,
      signatureSpots: original.meta?.signatureSpots || [],
      record: {
        signerName: signature.name,
        statement: `${signature.name} signed this ${label.toLowerCase()} electronically, after confirming a one-time code sent to their email address. The fingerprint below identifies the exact document they were shown: any change to that document gives a different fingerprint.`,
        rows,
      },
    })
    const after = sha256(signedBytes)
    const filename = original.filename.replace(/\.pdf$/i, '-signed.pdf')
    const put = await putBlob(`applications/${application.id}/offer.${kind}-signed-${filename}`, Buffer.from(signedBytes), { contentType: 'application/pdf' })
    const [row] = await db
      .insert(applicationDocuments)
      .values({
        applicationId: application.id,
        slot: `offer.${kind}.signed`,
        docType: `${kind}_signed`,
        label: `${label} (signed)`,
        pathname: put.pathname,
        url: put.url,
        filename,
        contentType: 'application/pdf',
        size: signedBytes.length,
        source: 'system',
        meta: { kind, signed: true, sha256: after, signedFrom: original.id, signatureId: id, templateVersion: original.meta?.templateVersion ?? null },
      })
      .returning()
    recorded.push({ kind, label, documentId: original.id, sha256: before, signedDocumentId: row.id, signedSha256: after, templateVersion: original.meta?.templateVersion ?? null })
  }

  const record = {
    id,
    applicationId: application.id,
    signerName: signature.name,
    signerEmail: application.applicantEmail,
    method: signature.method,
    image: signature.dataUrl,
    codeVerified,
    capturedBy: capturedBy?.id ?? null,
    ip,
    userAgent,
    documents: recorded,
    signedAt,
  }
  const [saved] = await db
    .insert(signatures)
    .values({ ...record, seal: sealOf(record) })
    .returning()
  return saved
}

/**
 * Undoes a signature whose acceptance then failed (a stale screen, an offer that lapsed
 * meanwhile), so no signed copy exists for an offer that was never accepted.
 */
export const discardSignature = async (signature) => {
  if (!signature) return
  const db = await getDb()
  const ids = (signature.documents || []).map((entry) => entry.signedDocumentId).filter(Boolean)
  if (ids.length) {
    const rows = await db.select().from(applicationDocuments).where(and(eq(applicationDocuments.applicationId, signature.applicationId), inArray(applicationDocuments.id, ids)))
    await deleteBlobs(rows).catch(() => {})
    await db.delete(applicationDocuments).where(inArray(applicationDocuments.id, ids))
  }
  await db.delete(signatures).where(eq(signatures.id, signature.id))
}

/** The signature this application's acceptance may rest on: made for it, not yet used. */
export const signatureFor = async (db, applicationId, signatureId) => {
  if (!signatureId) return null
  const [row] = await db.select().from(signatures).where(and(eq(signatures.id, signatureId), eq(signatures.applicationId, applicationId))).limit(1)
  return row || null
}

/** An application's signatures, each with `sealValid` (see verifySeal) instead of the raw seal. */
export const signaturesOf = async (applicationId) => {
  const db = await getDb()
  const rows = await db.select().from(signatures).where(eq(signatures.applicationId, applicationId))
  return rows.map(({ seal, ...row }) => ({ ...row, sealValid: verifySeal({ ...row, seal }) }))
}
