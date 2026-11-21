/**
 * Pre-approved loans for the employees of partners the lender has an MoU with. Shared by
 * the API, which enforces it, and the workspace, which shows it.
 *
 * A loan product can be pre-approved for one partner (product.preApproval). An application
 * for it, once submitted and pre-screened, skips appraisal, review and approval:
 *
 *   prescreen the application is being pre-screened (set as it is submitted)
 *   partner   the partner's staff (role scope "partner") confirm the applicant works there,
 *             helped by the staff list the partner sent (Settings → Partners)
 *   issue     a sales manager or loan officer (offers.issue) issues the offer
 *   issued    the case is in the offer state, and carries on as any approved loan
 *   review    taken off this route (a check failed, the partner refused, or an officer sent
 *             it to full review): the case is worked as any other application
 *
 * The stage is kept on the case (applications.pre_approval); the case stays in the
 * workflow's start state until the offer is issued.
 */

export const PRE_APPROVAL_STAGES = {
  prescreen: { label: 'Pre-screening', description: 'The application is being pre-screened before it goes to the partner.' },
  partner: { label: 'Waiting for the partner', description: 'The partner confirms the applicant works there.' },
  issue: { label: 'Ready to issue the offer', description: 'The partner confirmed employment.' },
  issued: { label: 'Offer issued', description: '' },
  review: { label: 'Moved to full review', description: '' },
}

/** The stages in which the case is still on the pre-approval route. */
export const ACTIVE_PRE_APPROVAL_STAGES = ['prescreen', 'partner', 'issue']

export const isOnPreApprovalRoute = (application) => ACTIVE_PRE_APPROVAL_STAGES.includes(application?.preApproval?.stage)

/**
 * Until the partner answers (pre-screening, then waiting for the partner), the case is the
 * partner's to look at: no one else validates or reviews it, except a system administrator.
 */
export const HELD_PRE_APPROVAL_STAGES = ['prescreen', 'partner']

export const heldForPartner = (application) => application?.status === 'submitted' && HELD_PRE_APPROVAL_STAGES.includes(application?.preApproval?.stage)

/** Who may still act on a held case from the case page: system administrators. */
export const mayActOnHeldCase = (user) => user?.role === 'admin'

/** Why a held case can't be worked, for the case page and the API's refusal. */
export const heldReason = (application) => {
  const partner = application?.preApproval?.partnerName || 'the partner'
  return application?.preApproval?.stage === 'prescreen'
    ? `This pre-approved application is still being pre-screened, then goes to ${partner} to confirm employment. Until ${partner} answers, only their staff or a system administrator can act on it.`
    : `Waiting for ${partner} to confirm the applicant works there. Until they answer, only their staff or a system administrator can act on this case.`
}

/**
 * What a partner's staff see of an application to confirm employment: who the person is
 * and what they said about their job, and these documents. Nothing else (no bank
 * statements, TPIN, address, next of kin or loan purpose).
 */
export const PARTNER_DOCUMENT_SLOTS = ['nrcCopy', 'passportCopy', 'passportPhoto', 'payslips']

export const PARTNER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

/** The most rows one staff list upload takes. */
export const STAFF_LIST_MAX_ROWS = 20000

export const DEFAULT_PRE_APPROVAL = { enabled: false, partnerId: null, maxAmount: null }

/** An NRC as stored and compared: no spaces. */
export const normaliseNrc = (value) => String(value ?? '').replace(/\s+/g, '')

const NRC_PATTERN = /^\d{6}\/\d{2}\/\d$/
export const isNrc = (value) => NRC_PATTERN.test(normaliseNrc(value))

/** YYYY-MM-DD for `date` (local calendar day). */
const isoDay = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Switched on, and its MoU hasn't ended (it runs to the end of its last day). */
export const partnerActive = (partner, today = new Date()) => Boolean(partner?.active) && Boolean(partner?.mouEndsOn) && partner.mouEndsOn >= isoDay(today)

/** Why a partner can't take pre-approved applications now, or null when it can. */
export const partnerInactiveReason = (partner, today = new Date()) => {
  if (!partner) return 'The partner set on the product no longer exists.'
  if (!partner.active) return `${partner.name} is paused.`
  if (!partner.mouEndsOn || partner.mouEndsOn < isoDay(today)) return `The ${partner.name} MoU has ended.`
  return null
}

/** Splits one CSV line, honouring double-quoted fields. */
const splitLine = (line) => {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',' || char === ';') {
      cells.push(cell)
      cell = ''
    } else cell += char
  }
  cells.push(cell)
  return cells.map((entry) => entry.trim())
}

const HEADERS = {
  nrc: ['nrc', 'nrc number', 'nrc_number', 'national id'],
  employeeNumber: ['employee_number', 'employee number', 'employee no', 'employee no.', 'staff number', 'staff_number', 'man number', 'man_number'],
  name: ['name', 'full name', 'full_name', 'employee name'],
}

/**
 * A partner's staff list from CSV. The first row names the columns (any case): `nrc` is
 * required, `employee_number` and `name` optional. Returns the rows it could read, NRCs
 * normalised and de-duplicated, and the line numbers it couldn't (no valid NRC).
 */
export const parseStaffCsv = (text) => {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
  const header = splitLine(lines[0] || '').map((cell) => cell.toLowerCase())
  const column = (key) => header.findIndex((cell) => HEADERS[key].includes(cell))
  const at = { nrc: column('nrc'), employeeNumber: column('employeeNumber'), name: column('name') }
  if (at.nrc < 0) return { rows: [], errors: [], missingHeader: true }
  const rows = []
  const errors = []
  const seen = new Set()
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return
    const cells = splitLine(line)
    const nrc = normaliseNrc(cells[at.nrc])
    if (!isNrc(nrc)) {
      errors.push(index + 2)
      return
    }
    if (seen.has(nrc)) return
    seen.add(nrc)
    rows.push({
      nrc,
      employeeNumber: at.employeeNumber >= 0 ? cells[at.employeeNumber]?.slice(0, 40) || null : null,
      name: at.name >= 0 ? cells[at.name]?.slice(0, 120) || null : null,
    })
  })
  return { rows, errors, missingHeader: false }
}
