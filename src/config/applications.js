/**
 * Application vocabulary shared by the API and both front ends: statuses, the
 * document slots each product asks for, and how channels are named.
 */

import { roleLabel } from './roles.js'
import { DEFAULT_CHECKLIST } from './stages.js'
import { DOCUMENT_CATALOGUE, defaultDocuments, getProduct } from './loanProducts.js'
import { PASSPORT_DOCUMENT, presentDocuments } from './applicantRules.js'

/**
 * `customer` is what the applicant sees — plain, and never an internal verdict. A case
 * waiting on a second approver still reads as "Being reviewed" to them.
 */
export const APPLICATION_STATUSES = {
  submitted: {
    label: 'Submitted',
    customer: 'Received',
    customerDetail: 'We have your application and it is waiting for a loan officer.',
    tone: 'info',
    open: true,
  },
  in_review: {
    label: 'In review',
    customer: 'Being reviewed',
    customerDetail: 'A loan officer is checking your details and documents.',
    tone: 'progress',
    open: true,
  },
  info_requested: {
    label: 'Information requested',
    customer: 'We need something from you',
    customerDetail: 'Please send what we asked for so we can carry on.',
    tone: 'attention',
    open: true,
  },
  pending_approval: {
    label: 'Awaiting approval',
    customer: 'Being reviewed',
    customerDetail: 'Your application is with a senior officer for a final decision.',
    tone: 'progress',
    open: true,
  },
  approved: {
    label: 'Approved',
    customer: 'Approved',
    customerDetail: 'Your loan has been approved.',
    tone: 'success',
    open: false,
  },
  accepted: {
    label: 'Offer accepted',
    customer: 'Offer accepted',
    customerDetail: 'You accepted the offer. We will be in touch about the payout.',
    tone: 'success',
    open: false,
  },
  declined: {
    label: 'Declined',
    customer: 'Not approved',
    customerDetail: 'We were not able to approve this application.',
    tone: 'muted',
    open: false,
  },
  withdrawn: {
    label: 'Withdrawn',
    customer: 'Withdrawn',
    customerDetail: 'This application was withdrawn.',
    tone: 'muted',
    open: false,
  },
  expired: {
    label: 'Offer expired',
    customer: 'Offer expired',
    customerDetail: 'The offer was not accepted in time. You are welcome to apply again.',
    tone: 'muted',
    open: false,
  },
  disbursed: {
    label: 'Disbursed',
    customer: 'Paid out',
    customerDetail: 'Your loan has been paid out.',
    tone: 'success',
    open: false,
  },
}

// Staff-facing names the workspace gave its statuses (Settings → Stages), once loaded.
let renamed = {}

export const registerStatusLabels = (labels) => {
  renamed = Object.fromEntries(Object.entries(labels || {}).filter(([, label]) => typeof label === 'string' && label.trim()))
}

/** The workspace's own name for a status, or null when it kept the default. */
export const renamedStatus = (status) => renamed[status] || null

/** A status as staff see it. Customers see APPLICATION_STATUSES[status].customer instead. */
export const statusLabel = (status) => renamed[status] || APPLICATION_STATUSES[status]?.label || status
export const OPEN_STATUSES = Object.keys(APPLICATION_STATUSES).filter((status) => APPLICATION_STATUSES[status].open)
/** Approved in some form: counted as approvals in dashboards. */
export const APPROVED_STATUSES = ['approved', 'accepted', 'disbursed']
/** Customers can still withdraw from these. */
export const WITHDRAWABLE_STATUSES = [...OPEN_STATUSES, 'approved']

export const LOAN_TYPE_LABELS = { personal: 'Personal loan', business: 'Business loan' }

export const CHANNELS = {
  self: 'Applied online',
  dsa: 'Direct sales agent',
  rm: 'Relationship manager',
}

/** An application's channel is "self" or the role of whoever brought it in, custom roles included. */
export const channelLabel = (channel) => CHANNELS[channel] || roleLabel(channel)

/**
 * The built-in products' document slots, by form — for demo data and tests. Live
 * applications read their product's own list (product.documents, Settings → Loan products).
 */
export const DOCUMENT_SLOTS = Object.fromEntries(Object.keys(DOCUMENT_CATALOGUE).map((form) => [form, defaultDocuments(form)]))

const DIRECTOR_SLOT = /^director\.(\d+)\.(nrc|passportPhoto)$/
const COLLATERAL_SLOT = /^collateral\.(\d+)$/

// Helpers take a product, or (older callers, and applications from before products) a form name.
const asProduct = (product) => (typeof product === 'string' ? getProduct(product) || getProduct('personal') : product || getProduct('personal'))

/** Label and doc type for any slot: the product's own, the per-director ones (director.0.nrc), and collateral proofs (collateral.0). */
export const describeSlot = (product, slot) => {
  const director = DIRECTOR_SLOT.exec(slot)
  if (director) {
    const number = Number(director[1]) + 1
    return director[2] === 'nrc'
      ? { slot, label: `Director ${number} NRC`, required: true, docType: 'directorNrc' }
      : { slot, label: `Director ${number} passport photo`, required: true, docType: 'directorPassportPhoto' }
  }
  const collateral = COLLATERAL_SLOT.exec(slot)
  if (collateral) return { slot, label: `Collateral ${Number(collateral[1]) + 1} proof`, required: false, docType: 'collateral' }
  if (slot === PASSPORT_DOCUMENT.slot) {
    const nrc = asProduct(product).documents.find((entry) => entry.slot === 'nrcCopy')
    return { slot, label: PASSPORT_DOCUMENT.label, required: Boolean(nrc?.required), docType: PASSPORT_DOCUMENT.docType, description: PASSPORT_DOCUMENT.description }
  }
  const own = asProduct(product).documents.find((entry) => entry.slot === slot)
  if (own) return { slot, label: own.label, required: Boolean(own.required), docType: own.docType, description: own.description || '' }
  // A slot the product no longer lists (changed since the application was made): the catalogue still names it.
  const known = Object.values(DOCUMENT_CATALOGUE).flat().find((entry) => entry.slot === slot)
  return known ? { slot, label: known.label, required: false, docType: known.docType } : { slot, label: slot, required: false, docType: slot.startsWith('custom.') ? 'custom' : slot }
}

/**
 * Draft storage keys files by their path in the form ("personal.documents.payslips",
 * "business.documents.directorUploads.0.nrc", "personal.documents.collateral.0");
 * applications key them by slot. Custom documents keep their dot ("documents.custom.title-deed").
 */
export const slotFromDraftPath = (path) => {
  const match = /^(?:personal|business)\.documents\.(.+)$/.exec(path)
  if (!match) return null
  const director = /^directorUploads\.(\d+)\.(nrc|passportPhoto)$/.exec(match[1])
  return director ? `director.${director[1]}.${director[2]}` : match[1]
}

const directorSlots = (product, data) => {
  const directors = asProduct(product).form === 'business' ? data?.directorInfo?.directors?.length || 0 : 0
  return Array.from({ length: directors }, (_, index) => [`director.${index}.nrc`, `director.${index}.passportPhoto`]).flat()
}

/**
 * Every slot an application of this shape must have: the product's required documents
 * that apply to these answers (no payslips without a salary, applicantRules.js), and each director's.
 */
export const requiredSlots = (product, data) => {
  const shown = presentDocuments(asProduct(product), data)
  return [...shown.filter((entry) => entry.required && !entry.skipped).map((entry) => entry.slot), ...directorSlots(product, data)]
}

/** Every slot an officer can ask the applicant to send again (or add on the case): optional ones, directors and collateral proofs included. */
export const requestableSlots = (product, data) => {
  const pledged = Array.isArray(data?.collateral?.items) ? data.collateral.items.length : 0
  const collateral = Array.from({ length: pledged }, (_, index) => `collateral.${index}`)
  // A passport copy too, when the applicant gave one in place of their NRC.
  const passport = presentDocuments(asProduct(product), data).some((entry) => entry.slot === PASSPORT_DOCUMENT.slot) ? [PASSPORT_DOCUMENT.slot] : []
  return [...asProduct(product).documents.map((entry) => entry.slot), ...passport, ...directorSlots(product, data), ...collateral].map((slot) => describeSlot(product, slot))
}

// Uploads a newer copy can replace. Generated documents and signed copies keep every version.
const REPLACEABLE_SOURCES = ['applicant', 'info_response', 'staff']

/**
 * Which document replaced which: a newer upload to the same slot (sent after a request, or
 * added by staff) supersedes the older one, so the rules, the AI review and the summary
 * read the newest copy. Returns { [olderId]: newerId }.
 */
export const supersededDocuments = (documents) => {
  const newest = new Map()
  for (const document of documents) {
    if (!REPLACEABLE_SOURCES.includes(document.source || 'applicant')) continue
    const seen = newest.get(document.slot)
    if (!seen || new Date(document.createdAt) >= new Date(seen.createdAt)) newest.set(document.slot, document)
  }
  return Object.fromEntries(
    documents.filter((document) => newest.has(document.slot) && newest.get(document.slot) !== document && REPLACEABLE_SOURCES.includes(document.source || 'applicant')).map((document) => [document.id, newest.get(document.slot).id])
  )
}

/** The documents in force: each slot's newest upload (see supersededDocuments). */
export const currentDocuments = (documents) => {
  const replaced = supersededDocuments(documents)
  return documents.filter((document) => !replaced[document.id])
}

/**
 * The verification checklist an officer works through. `requiredToApprove` checks must
 * be ticked (with a note saying what was seen) before recommending approval.
 */
/** The default checklist, by key. The live one is configurable (Settings → Stages, stages.js). */
export const CHECKS = Object.fromEntries(DEFAULT_CHECKLIST.map(({ key, ...check }) => [key, check]))

export const LMS_SYNC_LABELS = {
  not_configured: 'No LMS connected',
  waiting: 'Sent once approved',
  pending: 'Queued for the LMS',
  sending: 'Sending to the LMS',
  synced: 'In the LMS',
  failed: 'LMS hand-off failed',
  uncertain: 'LMS receipt unconfirmed',
}
