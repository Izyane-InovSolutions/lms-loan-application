/**
 * Answers that change what else an application asks for: an applicant's employment
 * decides whether there is an employer (and payslips), and a business's legal form
 * decides whether it has directors, a Form 2 and a board resolution. Shared by the
 * wizard (what it shows and checks) and the server (what it requires at submit), so
 * the two never disagree.
 *
 * Answers from before these lists existed (free text, or blank) keep the old behaviour:
 * everything asked, as it was.
 */

/** `employer`: 'employer' asks who employs them, 'business' asks for their business, null asks neither. */
export const EMPLOYMENT_OPTIONS = [
  { value: 'Employed', label: 'Employed (salaried)', employer: 'employer' },
  { value: 'Civil servant', label: 'Civil servant', employer: 'employer' },
  { value: 'Self-employed', label: 'Self-employed', employer: 'business' },
  { value: 'Business owner', label: 'Business owner', employer: 'business' },
  { value: 'Retired', label: 'Retired', employer: null },
  { value: 'Unemployed', label: 'Not working', employer: null },
  { value: 'Student', label: 'Student', employer: null },
]

const employment = (occupation) => EMPLOYMENT_OPTIONS.find((option) => option.value === occupation)

/** 'employer', 'business' or null: which second question the occupation leads to. */
export const employerQuestion = (occupation) => {
  const known = employment(occupation)
  return known ? known.employer : 'employer'
}

/** The label and hint for the second question, or null when there is none. */
export const employerField = (occupation) => {
  const question = employerQuestion(occupation)
  if (question === 'employer') return { label: 'Employer name', hint: 'The organisation that pays your salary.' }
  if (question === 'business') return { label: 'Business name', hint: 'The name your business trades under.' }
  return null
}

/** Whether the applicant is paid a salary, so has payslips. */
export const isSalaried = (personalData) => employerQuestion(personalData?.employmentInfo?.occupation) === 'employer'

/** Business legal forms; `incorporated` ones have directors, a Form 2 and a board. */
export const BUSINESS_STRUCTURES = [
  { value: 'Sole Proprietorship', incorporated: false, people: { one: 'Owner', many: 'Owners', max: 1 } },
  { value: 'Partnership', incorporated: false, people: { one: 'Partner', many: 'Partners', max: 3 } },
  { value: 'Limited Liability Company (LLC)', incorporated: true, people: { one: 'Director', many: 'Directors', max: 3 } },
  { value: 'Corporation', incorporated: true, people: { one: 'Director', many: 'Directors', max: 3 } },
]

const structure = (businessType) => BUSINESS_STRUCTURES.find((entry) => entry.value === businessType)

export const isIncorporated = (businessType) => structure(businessType)?.incorporated ?? true

/** What the business's people are called and how many may be listed: directors, partners, or the owner. */
export const businessPeople = (businessType) => structure(businessType)?.people || { one: 'Director', many: 'Directors', max: 3 }

/**
 * Whether a product's document applies to these answers: payslips only for salaried
 * applicants; Form 2 and a board resolution only for incorporated companies.
 */
export const documentApplies = (slot, form, data) => {
  if (slot === 'payslips' && form === 'personal') return isSalaried(data)
  if ((slot === 'form2' || slot === 'boardResolution') && form === 'business') return isIncorporated(data?.businessInfo?.businessType)
  return true
}

/** Why a document is left out, for the applicant: shown in place of the upload. */
export const documentSkipReason = (slot, form) => {
  if (slot === 'payslips' && form === 'personal') return 'Not needed: you told us you aren’t paid a salary.'
  if (form === 'business' && (slot === 'form2' || slot === 'boardResolution')) return 'Not needed for a sole proprietorship or partnership.'
  return ''
}

/** Zambians give their NRC; anyone else their passport. Blank (not chosen yet, or from before) counts as Zambian. */
export const isZambian = (nationality) => !nationality || nationality === 'Zambia'

/** Which ID number the form asks for, by nationality: the field it is kept in, and how it is named. */
export const idField = (nationality, prefix = '') =>
  isZambian(nationality)
    ? { key: prefix ? `${prefix}Nrc` : 'nrc', label: 'NRC', kind: 'nrc' }
    : { key: prefix ? `${prefix}PassportNumber` : 'passportNumber', label: 'Passport number', kind: 'passport' }

/** A passport's number as printed: letters and digits, 6 to 12 of them. */
export const isValidPassportNumber = (value) => /^[A-Z0-9]{6,12}$/i.test(String(value || '').replace(/\s/g, ''))

/** Asked of non-Zambian applicants in place of the NRC copy, with the same required flag. */
export const PASSPORT_DOCUMENT = { slot: 'passportCopy', label: 'Passport copy', docType: 'passport', description: 'The page with your photo and details.' }

const nationalityOf = (form, data) => (form === 'personal' ? data?.employmentInfo?.nationality : data?.directorInfo?.applicantNationality)

/**
 * The product's documents as this applicant sees them: a passport copy in place of the
 * NRC copy for non-Zambians, and `skipped` (the reason) on those that don't apply.
 */
export const presentDocuments = (product, data) =>
  product.documents.map((document) => {
    if (document.slot === 'nrcCopy' && !isZambian(nationalityOf(product.form, data))) return { ...PASSPORT_DOCUMENT, required: document.required, skipped: '' }
    return documentApplies(document.slot, product.form, data) ? { ...document, skipped: '' } : { ...document, skipped: documentSkipReason(document.slot, product.form) }
  })

/** Positions the person applying for a business can hold, by its legal form ("Other" asks them to say). */
export const positionsFor = (businessType) => {
  const structure = BUSINESS_STRUCTURES.find((entry) => entry.value === businessType)
  if (structure?.value === 'Sole Proprietorship') return ['Owner', 'Manager', 'Other']
  if (structure?.value === 'Partnership') return ['Partner', 'Manager', 'Other']
  return ['Director', 'Manager', 'Other']
}

/** The position as stated: the choice, or what they typed under "Other". */
export const positionLabel = (directorInfo) =>
  directorInfo?.applicantPosition === 'Other' ? String(directorInfo?.applicantPositionOther || '').trim() || 'Other' : directorInfo?.applicantPosition || ''
