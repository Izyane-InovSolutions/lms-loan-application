import { fail } from '../http.js'
import { formatNrc } from './normalize.js'

const clean = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/**
 * Who the bureau is asked about: the applicant on a personal loan, the applying
 * director on a business loan — read from the application as submitted, never typed in
 * by staff, so a report cannot be pulled for someone the case is not about.
 */
export const identityFor = (application) => {
  const personal = application.loanType === 'personal'
  const source = (personal ? application.data?.personalInfo : application.data?.directorInfo) || {}
  const identity = personal
    ? { nrc: source.nrc, firstName: source.firstName, middleName: source.middleName, surname: source.surname, dateOfBirth: source.birthDate }
    : { nrc: source.applicantNrc, firstName: source.applicantFirstName, middleName: source.applicantMiddleName, surname: source.applicantLastName, dateOfBirth: source.applicantBirthDate }

  const nrc = formatNrc(clean(identity.nrc))
  const firstName = clean(identity.firstName)
  const surname = clean(identity.surname)
  const otherNames = [firstName, clean(identity.middleName)].filter(Boolean).join(' ')
  const missing = [!nrc && 'NRC', !firstName && 'first name', !surname && 'surname'].filter(Boolean)
  if (missing.length) fail(422, `The application has no ${missing.join(', ')} for the applicant, so the bureau cannot be asked.`, 'crb_identity_incomplete')
  // A Zambian NRC: six digits, two, one — 123456/78/9.
  if (!/^\d{6}\/\d{2}\/\d$/.test(nrc)) fail(422, 'The applicant’s NRC is not in the 123456/78/9 format, so the bureau cannot be asked.', 'crb_identity_invalid')

  return { nrc, otherNames, surname, name: `${otherNames} ${surname}`, dateOfBirth: clean(identity.dateOfBirth) || null }
}
