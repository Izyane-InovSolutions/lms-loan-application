/**
 * Application vocabulary shared by the API and both front ends: statuses, the
 * document slots each product asks for, and how channels are named.
 */

import { roleLabel } from './roles.js'
import { DEFAULT_CHECKLIST } from './stages.js'

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

/** Upload slots per product: key (the wizard's field), label, whether required, and the AI doc type. */
export const DOCUMENT_SLOTS = {
  personal: [
    { slot: 'payslips', label: 'Latest three payslips', required: true, docType: 'payslips' },
    { slot: 'bankStatements', label: 'Bank statements', required: true, docType: 'bankStatements' },
    { slot: 'nrcCopy', label: 'NRC copy', required: true, docType: 'nrcCopy' },
    { slot: 'passportPhoto', label: 'Passport photo', required: true, docType: 'passportPhoto' },
    { slot: 'tpin', label: 'TPIN certificate', required: true, docType: 'tpin' },
  ],
  business: [
    { slot: 'pacraCertificate', label: 'PACRA certificate', required: true, docType: 'pacraCertificate' },
    { slot: 'form2', label: 'Form 2', required: true, docType: 'form2' },
    { slot: 'taxClearance', label: 'Tax clearance certificate / TPIN', required: true, docType: 'taxClearance' },
    { slot: 'latestTaxComplianceReturn', label: 'Latest tax compliance return', required: true, docType: 'latestTaxComplianceReturn' },
    { slot: 'orderOrInvoice', label: 'Order / invoice', required: false, docType: 'orderOrInvoice' },
    { slot: 'bankStatements', label: 'Bank statements', required: true, docType: 'bankStatements' },
    { slot: 'boardResolution', label: 'Board resolution', required: true, docType: 'boardResolution' },
    { slot: 'passportPhoto', label: 'Applicant passport photo', required: true, docType: 'passportPhoto' },
  ],
}

const DIRECTOR_SLOT = /^director\.(\d+)\.(nrc|passportPhoto)$/

/** Label and doc type for any slot, including the per-director ones (director.0.nrc). */
export const describeSlot = (loanType, slot) => {
  const director = DIRECTOR_SLOT.exec(slot)
  if (director) {
    const number = Number(director[1]) + 1
    return director[2] === 'nrc'
      ? { slot, label: `Director ${number} NRC`, required: true, docType: 'directorNrc' }
      : { slot, label: `Director ${number} passport photo`, required: true, docType: 'directorPassportPhoto' }
  }
  return (DOCUMENT_SLOTS[loanType] || []).find((entry) => entry.slot === slot) || { slot, label: slot, required: false, docType: slot }
}

/**
 * Draft storage keys files by their path in the form ("personal.documents.payslips",
 * "business.documents.directorUploads.0.nrc"); applications key them by slot.
 */
export const slotFromDraftPath = (path) => {
  const match = /^(?:personal|business)\.documents\.(.+)$/.exec(path)
  if (!match) return null
  const director = /^directorUploads\.(\d+)\.(nrc|passportPhoto)$/.exec(match[1])
  return director ? `director.${director[1]}.${director[2]}` : match[1]
}

/** Every slot an application of this shape must have, directors included. */
export const requiredSlots = (loanType, data) => {
  const base = (DOCUMENT_SLOTS[loanType] || []).filter((entry) => entry.required).map((entry) => entry.slot)
  if (loanType !== 'business') return base
  const directors = data?.directorInfo?.directors?.length || 0
  const perDirector = Array.from({ length: directors }, (_, index) => [`director.${index}.nrc`, `director.${index}.passportPhoto`]).flat()
  return [...base, ...perDirector]
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
