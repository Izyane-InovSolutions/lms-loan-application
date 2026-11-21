import kv from './kv.js'
import { generateToken } from './token.js'
import { getSetting } from './settings.js'
import { getSms } from './sms.js'

/*
 * Confirming the email or phone an application is started with (Settings → Customer
 * options, verifyAtStart), against someone starting one in another person's name.
 *
 *   1. POST /verification/start sends a code (purpose "start") by email, or by SMS when a
 *      provider is set up.
 *   2. POST /verification/check takes the code and hands back a ticket.
 *   3. The draft (api/draft/index.js) redeems the ticket: draft.verified = { channel, value, at }.
 *
 * At submission the verified contact must still be the one on the form; the application
 * keeps it (contact_verification). A code only proves control of the contact: the ID and
 * contact checks in identityFlags.js warn staff about the rest.
 */

export const TICKET_TTL_SECONDS = 30 * 60
export const CHANNELS = ['email', 'phone']

const ticketKey = (ticket) => `verify-ticket:${ticket}`

/** A Zambian mobile number as +260XXXXXXXXX, from 9 digits, 0-prefixed or +260; else null. */
export const normalisePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 9) return `+260${digits}`
  if (digits.length === 10 && digits.startsWith('0')) return `+260${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('260')) return `+${digits}`
  return null
}

export const normaliseEmail = (value) => String(value || '').trim().toLowerCase() || null

/** The applicant's email and phone as the form holds them: the applicant, or the applying director. */
export const contactOf = (loanType, data) => {
  const source = loanType === 'business' ? data?.directorInfo : data?.personalInfo
  return {
    email: normaliseEmail(loanType === 'business' ? source?.applicantEmail : source?.email),
    phone: normalisePhone(loanType === 'business' ? source?.applicantPhone : source?.phone),
  }
}

/** The code's subject: which contact it was sent to. */
export const subjectFor = (channel, value) => `${channel}:${value}`

export const verificationRequired = async () => (await getSetting('customerOptions')).verifyAtStart !== false

export const smsAvailable = async () => Boolean(await getSms())

export const issueTicket = async (channel, value) => {
  const ticket = generateToken()
  await kv.set(ticketKey(ticket), { channel, value }, { ex: TICKET_TTL_SECONDS })
  return ticket
}

/** The verified contact behind a ticket, once: the ticket is spent. Null when unknown or expired. */
export const redeemTicket = async (ticket) => {
  if (typeof ticket !== 'string' || !/^[0-9a-f]{48}$/.test(ticket)) return null
  const entry = await kv.get(ticketKey(ticket))
  if (!entry) return null
  await kv.del(ticketKey(ticket))
  return entry
}

/** Whether `verified` (a draft's) still names the contact the form holds for its channel. */
export const stillVerified = (verified, contact) => Boolean(verified?.channel && verified.value && contact?.[verified.channel] === verified.value)
