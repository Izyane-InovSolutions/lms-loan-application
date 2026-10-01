import crypto from 'node:crypto'

/*
 * Turns a Product 109 bureau response into what the LOS stores and shows. Ported from
 * the adapter that already runs against this bureau (adapter/services/CRB/utils.py):
 * the same sections, the same field fallbacks and the same commitment rules, so both
 * systems read a report the same way.
 *
 * Bureau values arrive as strings full of placeholders ("N/A", "-", "#N/A"); everything
 * here treats those as missing rather than as data.
 */

const EMPTY_VALUES = new Set(['', 'N/A', '#N/A', '-', '--', ' - ', '—', 'NOT AVAILABLE', 'UNSPECIFIED'])

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && EMPTY_VALUES.has(value))

export const ensureList = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export const safeStr = (value) => {
  if (isEmpty(value) || typeof value === 'object') return null
  const text = String(value).trim()
  return text || null
}

export const safeNumber = (value, fallback = 0) => {
  if (isEmpty(value)) return fallback
  const number = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : fallback
}

export const safeInt = (value, fallback = null) => {
  const number = safeNumber(value, NaN)
  return Number.isFinite(number) ? Math.trunc(number) : fallback
}

const money = (value) => Math.round(value * 100) / 100

/** Dates become ISO strings and placeholders become null, so the result is plain JSON. */
export const jsonSafe = (value) => {
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value && typeof value === 'object') {
    // node-soap puts XML attributes under "attributes"; they carry no report data.
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'attributes').map(([key, entry]) => [key, jsonSafe(entry)]))
  }
  return isEmpty(value) ? null : value
}

/** 123456 78 1, 123456-78-1 → 123456/78/1. Anything else is returned without spaces. */
export const formatNrc = (nrc) => {
  if (!nrc) return ''
  // Spaces may be the separators, so they are only collapsed here, not removed.
  const tidy = String(nrc).trim().replace(/\s*([/-])\s*/g, '$1').replace(/\s+/g, ' ')
  const match = tidy.match(/^(\d+)[/ -](\d+)[/ -](\d)$/)
  return match ? `${match[1]}/${match[2]}/${match[3]}` : tidy.replace(/\s+/g, '')
}

/**
 * The bureau answers either { reportData: {...} } or with the sections at the top level.
 * Either way this returns the same twelve sections, lists always as arrays.
 */
export const normalizeReport = (raw) => {
  const safe = jsonSafe(raw) || {}
  const rd = safe.reportData && typeof safe.reportData === 'object' ? safe.reportData : safe
  return {
    personalProfile: rd.personalProfile || {},
    scoreOutput: rd.scoreOutput || {},
    summary: rd.summary || {},
    header: rd.header || {},
    accountList: ensureList(rd.accountList),
    bouncedChequeList: ensureList(rd.bouncedChequeList),
    phoneList: ensureList(rd.phoneList),
    addressList: ensureList(rd.addressList || rd.physicalAddressList),
    directorshipList: ensureList(rd.directorshipList),
    shareholdingList: ensureList(rd.shareholdingList),
    postalAddressList: ensureList(rd.postalAddressList),
    recentEnquiryList: ensureList(rd.recentEnquiryList),
  }
}

// Same rules as the existing adapter, which counts closed and settled accounts as
// performing "as per requirement", and any balance over 100 as live.
const ACTIVE_KEYWORDS = ['active', 'current', 'performing', 'open', 'normal', 'good', 'closed', 'settled', 'early settlement', 'account closed', 'account closed status']
const NON_PERFORMING_KEYWORDS = ['written off']

const isDisputed = (account) => {
  const value = account.disputed
  return typeof value === 'string' ? value.trim().toLowerCase() === 'true' : Boolean(value)
}

/** Monthly commitments, outstanding balance and arrears across the accounts that count. */
export const extractCommitments = (reportData, { includeDisputed = false } = {}) => {
  let commitments = 0
  let outstanding = 0
  let arrears = 0
  let arrearDays = 0
  for (const account of ensureList(reportData?.accountList)) {
    if (!account) continue
    if (isDisputed(account) && !includeDisputed) continue
    const status = String(account.accountStatus || '').trim().toLowerCase()
    const balance = safeNumber(account.balanceAmount ?? account.outstandingBalance)
    let active = ACTIVE_KEYWORDS.some((keyword) => status.includes(keyword))
    if (balance > 100) active = true
    if (NON_PERFORMING_KEYWORDS.some((keyword) => status.includes(keyword))) active = false
    if (!active) continue
    commitments += safeNumber(account.scheduledPaymentAmount ?? account.monthlyInstalment)
    outstanding += balance
    arrears += safeNumber(account.arrearAmount)
    arrearDays = Math.max(arrearDays, safeInt(account.arrearDays, 0))
  }
  return { commitments: money(commitments), outstanding: money(outstanding), arrears: money(arrears), arrearDays }
}

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** SHA-256 of the report content alone, so an unchanged report is recognised on a later pull. */
export const reportFingerprint = (reportData) => crypto.createHash('sha256').update(stableStringify(reportData)).digest('hex')

const hasRecord = (rd) =>
  Boolean(Object.keys(rd.personalProfile).length || Object.keys(rd.scoreOutput).length || rd.accountList.length)

/**
 * Arrears and write-offs across every undisputed account. extractCommitments leaves
 * written-off accounts out of affordability, but they are the listings that matter most
 * to a credit decision, so they are counted here on their own.
 */
export const adverseListings = (accounts) => {
  const counted = accounts.filter((account) => account && !isDisputed(account))
  const inArrears = counted.filter((account) => safeNumber(account.arrearAmount) > 0)
  return {
    accountsInArrears: inArrears.length,
    arrearsOnRecord: money(inArrears.reduce((sum, account) => sum + safeNumber(account.arrearAmount), 0)),
    worstArrearDays: inArrears.reduce((worst, account) => Math.max(worst, safeInt(account.arrearDays, 0)), 0),
    writtenOff: counted.filter((account) => NON_PERFORMING_KEYWORDS.some((keyword) => String(account.accountStatus || '').toLowerCase().includes(keyword))).length,
  }
}

const describeRecord = (accounts, adverse) => {
  const parts = [`${accounts.length} account${accounts.length === 1 ? '' : 's'} on record`]
  if (adverse.writtenOff) parts.push(`${adverse.writtenOff} written off`)
  parts.push(
    adverse.accountsInArrears
      ? `K${adverse.arrearsOnRecord.toLocaleString('en-US')} in arrears on ${adverse.accountsInArrears} (worst ${adverse.worstArrearDays} days)`
      : 'none in arrears'
  )
  return `${parts.join(', ')}.`
}

// Enough for a credit decision; a heavily enquired-on record can hold thousands.
const MAX_STORED_ENQUIRIES = 100

const newestFirst = (list, field) =>
  [...list].sort((a, b) => String(b?.[field] || '').localeCompare(String(a?.[field] || '')))

/**
 * What goes in crb_reports: the headline figures staff read first, the full normalised
 * report beneath them, and whether the bureau's person is the one we asked about.
 *
 * @param raw       the operation's result, as returned by the SOAP client
 * @param requested { nrc } — the identity sent, for the match check
 */
export const buildStoredReport = (raw, requested) => {
  const reportData = normalizeReport(raw)
  // The bureau's own status for the enquiry. Its meanings are the bureau's to define, so
  // it is shown as sent; it is what tells "no record" apart from a refused request.
  const responseCode = safeInt(raw?.responseCode ?? raw?.reportData?.responseCode)
  const enquiryCount = reportData.recentEnquiryList.length
  reportData.recentEnquiryList = newestFirst(reportData.recentEnquiryList, 'enquiryDate').slice(0, MAX_STORED_ENQUIRIES)
  const score = reportData.scoreOutput
  const profile = reportData.personalProfile
  const totals = extractCommitments(reportData)
  const adverse = adverseListings(reportData.accountList)
  const grade = safeStr(score.grade ?? score.CreditGrade)
  const scoreBand = safeStr(score.scoreBand)
  const reportedNrc = formatNrc(safeStr(profile.nationalID ?? profile.nationalId))
  const found = hasRecord(reportData)
  return {
    score: safeInt(score.positiveScore ?? score.CreditScore),
    report: {
      product: '109',
      found,
      band: found ? scoreBand || (grade ? `Grade ${grade}` : 'No grade returned') : 'No record at the bureau',
      summary: found
        ? describeRecord(reportData.accountList, adverse)
        : `The bureau returned no credit report for this NRC${responseCode === null ? '' : ` (bureau response code ${responseCode})`}.`,
      responseCode,
      grade,
      scoreBand,
      probabilityOfDefault: safeNumber(score.probability ?? score.ProbabilityOfDefault, null),
      reasonCodes: ['reasonCodeAARC1', 'reasonCodeAARC2', 'reasonCodeAARC3', 'reasonCodeAARC4'].map((key) => safeStr(score[key])).filter(Boolean),
      ...totals,
      ...adverse,
      recentEnquiries: enquiryCount,
      bouncedCheques: reportData.bouncedChequeList.length,
      identity: {
        requestedNrc: requested.nrc,
        reportedNrc: reportedNrc || null,
        // Only a returned NRC that differs is a mismatch; no NRC back means nothing to compare.
        mismatch: Boolean(reportedNrc) && reportedNrc !== requested.nrc,
        reportedName: safeStr(profile.fullName) || [safeStr(profile.otherNames), safeStr(profile.surname)].filter(Boolean).join(' ') || null,
      },
      reportDate: safeStr(reportData.header.reportDate),
      requestNo: safeStr(reportData.header.requestNo ?? reportData.header.requestNumber),
      fingerprint: reportFingerprint(reportData),
      reportData,
    },
  }
}
