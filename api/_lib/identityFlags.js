import { desc, sql } from 'drizzle-orm'
import { schema } from './db/client.js'
import { isZambian } from '../../src/config/applicantRules.js'

const { applications } = schema

/*
 * Someone applying in another person's name (docs/superpowers/specs/2026-11-21-applicant-verification-design.md):
 * a code only proves the applicant controls an email or phone, so at submission the ID and
 * the contact are checked against earlier applications, both ways:
 *
 *   id_other_contact   this NRC (or passport) was used before with another email or phone
 *   contact_other_id   this email or phone was used before with another NRC (or passport)
 *
 * Staff are warned; nothing is blocked. They see the other details masked, with the earlier
 * application's reference.
 */

const MAX_FLAGS = 5

/** An ID as compared: letters and digits, lower case. */
export const normaliseId = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** A phone as compared: its last 9 digits. */
export const phoneKey = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

/** The applicant's ID (the applying director's on a business loan): the NRC, or the passport for non-Zambians. */
export const applicantId = (loanType, data) => {
  const business = loanType === 'business'
  const source = (business ? data?.directorInfo : data?.personalInfo) || {}
  const nationality = business ? source.applicantNationality : data?.employmentInfo?.nationality
  const value = isZambian(nationality) ? (business ? source.applicantNrc : source.nrc) : business ? source.applicantPassportNumber : source.passportNumber
  return normaliseId(value)
}

export const maskEmail = (email) => {
  const [local, domain] = String(email || '').split('@')
  return local && domain ? `${local[0]}…@${domain}` : '…'
}

export const maskPhone = (phone) => {
  const key = phoneKey(phone)
  return key ? `+260 ${key[0]}…${key.slice(-3)}` : '…'
}

export const maskId = (id) => (id ? `…${String(id).slice(-4)}` : '…')

// The same ID, read in SQL from an earlier application's data, as applicantId reads it.
const field = (path) => sql.raw(`coalesce(${path}, '')`)
const clean = (expression) => sql`lower(regexp_replace(${expression}, '[^a-zA-Z0-9]', '', 'g'))`
const ID_SQL = sql`case
  when ${applications.loanType} = 'business' then
    case when ${field(`"applications"."data"->'directorInfo'->>'applicantNationality'`)} in ('', 'Zambia')
      then ${clean(field(`"applications"."data"->'directorInfo'->>'applicantNrc'`))}
      else ${clean(field(`"applications"."data"->'directorInfo'->>'applicantPassportNumber'`))} end
  else
    case when ${field(`"applications"."data"->'employmentInfo'->>'nationality'`)} in ('', 'Zambia')
      then ${clean(field(`"applications"."data"->'personalInfo'->>'nrc'`))}
      else ${clean(field(`"applications"."data"->'personalInfo'->>'passportNumber'`))} end
end`
const PHONE_SQL = sql`right(regexp_replace(coalesce(${applications.applicantPhone}, ''), '[^0-9]', '', 'g'), 9)`
const EMAIL_SQL = sql`lower(${applications.applicantEmail})`

/** Whether `row` (an earlier application) had `channel` verified with `value`. */
const verifiedWith = (row, channel, value) => {
  const verification = row.contactVerification
  if (!verification || verification.channel !== channel) return false
  return channel === 'email' ? verification.value === value : phoneKey(verification.value) === phoneKey(value)
}

/**
 * Earlier applications whose ID or contact details don't match this one's (an empty list
 * when none). `db` may be a transaction.
 */
export const identityFlags = async (db, { loanType, data, email, phone }) => {
  const id = applicantId(loanType, data)
  const mail = String(email || '').trim().toLowerCase()
  const tel = phoneKey(phone)
  const flags = []

  if (id) {
    const rows = await db
      .select({ id: applications.id, reference: applications.reference, email: applications.applicantEmail, phone: applications.applicantPhone, contactVerification: applications.contactVerification })
      .from(applications)
      .where(sql`${ID_SQL} = ${id} and (${EMAIL_SQL} <> ${mail} or (${tel} <> '' and ${PHONE_SQL} <> '' and ${PHONE_SQL} <> ${tel}))`)
      .orderBy(desc(applications.submittedAt))
      .limit(MAX_FLAGS)
    for (const row of rows) {
      const otherEmail = row.email?.toLowerCase() !== mail
      flags.push({
        kind: 'id_other_contact',
        applicationId: row.id,
        reference: row.reference,
        contact: otherEmail ? maskEmail(row.email) : maskPhone(row.phone),
        channel: otherEmail ? 'email' : 'phone',
        verified: otherEmail ? verifiedWith(row, 'email', row.email?.toLowerCase()) : verifiedWith(row, 'phone', row.phone),
      })
    }
  }

  if (mail || tel) {
    const sameContact = tel ? sql`(${EMAIL_SQL} = ${mail} or ${PHONE_SQL} = ${tel})` : sql`${EMAIL_SQL} = ${mail}`
    const rows = await db
      .select({ id: applications.id, reference: applications.reference, email: applications.applicantEmail, phone: applications.applicantPhone, contactVerification: applications.contactVerification, otherId: ID_SQL })
      .from(applications)
      .where(sql`${sameContact} and ${ID_SQL} <> '' and ${ID_SQL} <> ${id}`)
      .orderBy(desc(applications.submittedAt))
      .limit(MAX_FLAGS)
    for (const row of rows) {
      const byEmail = row.email?.toLowerCase() === mail
      flags.push({
        kind: 'contact_other_id',
        applicationId: row.id,
        reference: row.reference,
        id: maskId(row.otherId),
        channel: byEmail ? 'email' : 'phone',
        contact: byEmail ? maskEmail(row.email) : maskPhone(row.phone),
        verified: byEmail ? verifiedWith(row, 'email', mail) : verifiedWith(row, 'phone', row.phone),
      })
    }
  }

  return flags.slice(0, MAX_FLAGS)
}

/** One line for the case timeline. */
export const describeFlags = (flags) =>
  flags
    .map((flag) =>
      flag.kind === 'id_other_contact'
        ? `this ID was used on ${flag.reference} with ${flag.channel === 'email' ? 'the email' : 'the phone'} ${flag.contact}${flag.verified ? ' (verified)' : ''}`
        : `this ${flag.channel === 'email' ? 'email' : 'phone'} was used on ${flag.reference} with the ID ${flag.id}${flag.verified ? ' (verified)' : ''}`
    )
    .join('; ')
