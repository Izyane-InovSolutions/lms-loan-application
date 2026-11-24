import { requireUser } from '../_lib/rbac.js'
import { appOrigin, fail, text } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { addStaffMember, decideRequest, listPartners, partnerById, partnerRequestDetail, partnerRequestDocument, partnerRequests, removeStaffMember, replaceStaffList, staffListPage, staffMatch, updateStaffMember } from '../_lib/preApproval.js'
import { readBlob } from '../_lib/blob.js'
import { sendFile } from './applications.js'
import { STAFF_LIST_MAX_ROWS, isNrc, parseStaffCsv } from '../../src/config/partners.js'

/*
 * Pre-approved partner loans (src/config/partners.js, api/_lib/preApproval.js):
 *
 *   Settings → Partners (settings.manage): upload a partner's staff list, look up one NRC,
 *     and page through the list (never handed back whole). The audit log keeps each look,
 *     with counts and the search, never NRCs.
 *   Partner requests (partner.confirm): the partner's staff confirm or refuse applicants. While
 *     a request waits for them they can open it: the applicant's identity and job details, and
 *     their ID copy, photo and payslips (PARTNER_DOCUMENT_SLOTS). Each opening is audited.
 */

const uploadStaffList = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  if (!(await partnerById(params.id))) fail(404, 'Partner not found.', 'not_found')
  const csv = String(req.body?.csv ?? '')
  if (!csv.trim()) fail(400, 'Choose the CSV file with the partner’s staff.', 'invalid_input')
  const { rows, errors, missingHeader } = parseStaffCsv(csv)
  if (missingHeader) fail(400, 'The first row must name the columns, with one called “nrc”.', 'invalid_csv')
  if (!rows.length) fail(400, 'No row has a valid NRC (123456/78/9).', 'invalid_csv')
  if (rows.length > STAFF_LIST_MAX_ROWS) fail(400, `A staff list can have up to ${STAFF_LIST_MAX_ROWS.toLocaleString()} people.`, 'too_large')
  const staffList = await replaceStaffList(params.id, rows, actor)
  await recordAudit({ req, actor, action: 'partner.staff_list_uploaded', entityType: 'partner', entityId: params.id, detail: { count: rows.length, skipped: errors.length, version: staffList.version } })
  return { staffList, count: rows.length, errors: errors.slice(0, 50), skipped: errors.length }
}

const lookUpStaff = async (req, res, { params, query }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const partner = await partnerById(params.id)
  if (!partner) fail(404, 'Partner not found.', 'not_found')
  const nrc = text(query.get('nrc'), 20)
  if (!isNrc(nrc)) fail(400, 'Enter an NRC as 123456/78/9.', 'invalid_input')
  const match = await staffMatch(partner, nrc)
  await recordAudit({ req, actor, action: 'partner.staff_looked_up', entityType: 'partner', entityId: params.id, detail: { found: match.onList } })
  return { found: match.onList, employeeNumber: match.employeeNumber, name: match.name }
}

/** A page of the partner's staff list, searchable (?q=, ?page=, ?pageSize= up to 100). */
const listStaff = async (req, res, { params, query }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const partner = await partnerById(params.id)
  if (!partner) fail(404, 'Partner not found.', 'not_found')
  const q = text(query.get('q'), 60)
  const page = Math.max(1, Number(query.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize')) || 25))
  const result = await staffListPage(partner, { q, page, pageSize })
  // A search that looks like an NRC isn't kept: only that one was made.
  await recordAudit({ req, actor, action: 'partner.staff_list_viewed', entityType: 'partner', entityId: params.id, detail: { page, shown: result.people.length, total: result.total, searched: Boolean(q) } })
  return result
}

/** The partner named in the path, for the staff-list changes by hand (settings.manage). */
const partnerToEdit = async (req, params) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const partner = await partnerById(params.id)
  if (!partner) fail(404, 'Partner not found.', 'not_found')
  return { actor, partner }
}

// Each change by hand is audited with the new count, never the NRC.
const addStaff = async (req, res, { params }) => {
  const { actor, partner } = await partnerToEdit(req, params)
  const result = await addStaffMember(partner, req.body || {}, actor)
  await recordAudit({ req, actor, action: 'partner.staff_added', entityType: 'partner', entityId: partner.id, detail: { count: result.staffList.count } })
  return result
}

const editStaff = async (req, res, { params }) => {
  const { actor, partner } = await partnerToEdit(req, params)
  const result = await updateStaffMember(partner, params.personId, req.body || {}, actor)
  await recordAudit({ req, actor, action: 'partner.staff_edited', entityType: 'partner', entityId: partner.id, detail: { count: result.staffList.count } })
  return result
}

const removeStaff = async (req, res, { params }) => {
  const { actor, partner } = await partnerToEdit(req, params)
  const result = await removeStaffMember(partner, params.personId, actor)
  await recordAudit({ req, actor, action: 'partner.staff_removed', entityType: 'partner', entityId: partner.id, detail: { count: result.staffList.count } })
  return result
}

/** The partners by name, for choosing which one a partner's staff member belongs to (Team). */
const listPartnerNames = async (req) => {
  await requireUser(req, { anyPermission: ['users.manage', 'settings.manage'] })
  return { partners: (await listPartners()).map((partner) => ({ id: partner.id, name: partner.name })) }
}

const listRequests = async (req, res, { query }) => {
  const viewer = await requireUser(req, { permission: 'partner.confirm' })
  return { requests: await partnerRequests(viewer, query.get('view') === 'recent' ? 'recent' : 'pending') }
}

const answerRequest = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'partner.confirm' })
  const request = await decideRequest(viewer, params.id, req.body || {}, { origin: appOrigin(req) })
  await recordAudit({ req, actor: viewer, action: request.partnerDecision?.confirmed ? 'partner.employment_confirmed' : 'partner.employment_refused', entityType: 'application', entityId: params.id, detail: { reference: request.reference, partner: request.partnerId } })
  return { request }
}

const getRequest = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'partner.confirm' })
  const request = await partnerRequestDetail(viewer, params.id)
  await recordAudit({ req, actor: viewer, action: 'partner.request_viewed', entityType: 'application', entityId: params.id, detail: { reference: request.reference, partner: request.partnerId } })
  return { request }
}

const getRequestDocument = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'partner.confirm' })
  const { application, document } = await partnerRequestDocument(viewer, params.id, params.documentId)
  const stored = await readBlob(document)
  if (!stored) fail(410, 'This file is no longer in storage.', 'gone')
  await recordAudit({ req, actor: viewer, action: 'partner.document_viewed', entityType: 'application', entityId: application.id, detail: { reference: application.reference, document: document.label } })
  sendFile(res, { data: stored.data, contentType: document.contentType || stored.contentType, filename: document.filename })
}

export const partnerRoutes = [
  ['POST', '/admin/partners/:id/staff', uploadStaffList],
  ['GET', '/admin/partners/:id/staff', lookUpStaff],
  ['GET', '/admin/partners/:id/staff/people', listStaff],
  ['POST', '/admin/partners/:id/staff/people', addStaff],
  ['PATCH', '/admin/partners/:id/staff/people/:personId', editStaff],
  ['DELETE', '/admin/partners/:id/staff/people/:personId', removeStaff],
  ['GET', '/partners', listPartnerNames],
  ['GET', '/partner/requests', listRequests],
  ['GET', '/partner/requests/:id', getRequest],
  ['GET', '/partner/requests/:id/documents/:documentId', getRequestDocument],
  ['POST', '/partner/requests/:id', answerRequest],
]
