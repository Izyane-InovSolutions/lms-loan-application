import { BUSINESS_STRUCTURES, EMPLOYMENT_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, NATIONALITY_OPTIONS, RELATIONSHIP_OPTIONS } from './applicantRules.js'

const BUSINESS_TYPE_OPTIONS = BUSINESS_STRUCTURES.map((entry) => entry.value)

/*
 * Customer records (KYC) from the institution's own platform (Settings → Customer records),
 * used to fill the application form (docs/superpowers/specs/2026-11-21-kyc-lookup-design.md).
 * Shared by the API, which looks records up and maps them, and the workspace, which
 * configures the mapping.
 *
 * A record is mapped into form fields by rows of { field, path, tidy }:
 *   field   a form field (FORM_TARGETS), or contact.mobile / contact.email: the contact on
 *           record a confirmation code may go to
 *   path    where in the record: `first_name`, `address.line1`, `profession.0`
 *   tidy    how the value is cleaned up for the form (TIDY_UPS)
 */

export const KYC_ID_TYPES = {
  nrc: { label: 'NRC', form: 'personal' },
  passport: { label: 'Passport', form: 'personal' },
  tpin: { label: 'TPIN', form: 'business' },
}

export const AUTH_TYPES = {
  none: 'None',
  apiKey: 'API key in a header',
  bearer: 'Bearer token',
  basic: 'Username and password (basic)',
  oauth: 'OAuth 2 client credentials',
}

export const TIDY_UPS = {
  none: 'As is',
  phone: 'Phone number (9 digits)',
  date: 'Date (YYYY-MM-DD)',
  choice: 'Match the form’s options',
  upper: 'UPPER CASE',
  lower: 'lower case',
}

export const OTHER_CONTACT_POLICIES = {
  none: 'Don’t fill the form: they fill it in themselves',
  fields: 'Fill only the fields ticked below',
  all: 'Fill everything',
  refuse: 'Not allowed: they must use a contact on record, or contact us',
}

/** The contact on record a code may go to. */
export const CONTACT_TARGETS = {
  'contact.mobile': 'Mobile number on record (for the code)',
  'contact.email': 'Email on record (for the code)',
}

/** The form fields a record may fill, by form, with the options a `choice` tidy-up matches. */
export const FORM_TARGETS = {
  personal: {
    'personalInfo.firstName': { label: 'First name' },
    'personalInfo.middleName': { label: 'Middle name' },
    'personalInfo.surname': { label: 'Surname' },
    'personalInfo.phone': { label: 'Phone' },
    'personalInfo.email': { label: 'Email' },
    'personalInfo.tpin': { label: 'TPIN' },
    'personalInfo.gender': { label: 'Gender', options: GENDER_OPTIONS },
    'personalInfo.maritalStatus': { label: 'Marital status', options: MARITAL_STATUS_OPTIONS },
    'personalInfo.birthDate': { label: 'Date of birth' },
    'employmentInfo.nationality': { label: 'Nationality', options: NATIONALITY_OPTIONS },
    'employmentInfo.residentialAddress': { label: 'Residential address' },
    'employmentInfo.occupation': { label: 'Occupation', options: EMPLOYMENT_OPTIONS.map((option) => option.value) },
    'employmentInfo.employerName': { label: 'Employer' },
    'employmentInfo.nextOfKinName': { label: 'Next of kin name' },
    'employmentInfo.nextOfKinPhone': { label: 'Next of kin phone' },
    'employmentInfo.nextOfKinEmail': { label: 'Next of kin email' },
    'employmentInfo.nextOfKinRelationship': { label: 'Next of kin relationship', options: RELATIONSHIP_OPTIONS },
  },
  business: {
    'businessInfo.companyName': { label: 'Company name' },
    'businessInfo.brn': { label: 'Business registration number' },
    'businessInfo.businessType': { label: 'Legal form', options: BUSINESS_TYPE_OPTIONS },
    'businessInfo.establishedDate': { label: 'Date established' },
    'businessInfo.natureOfBusiness': { label: 'Nature of business' },
    'businessInfo.registeredOffice': { label: 'Registered office' },
    'directorInfo.applicantEmail': { label: 'Applicant email' },
    'directorInfo.applicantPhone': { label: 'Applicant phone' },
  },
}

/** Where the ID looked up is written on the form. */
export const ID_FIELDS = { nrc: 'personalInfo.nrc', passport: 'personalInfo.passportNumber', tpin: 'businessInfo.tpin' }

// How records often word what the form offers as a choice: nationalities, employment and
// relationships (a record's "Son" is the form's "Child"). Used by the `choice` tidy-up.
const SYNONYMS = {
  zambian: 'Zambia',
  kenyan: 'Kenya',
  malawian: 'Malawi',
  rwandan: 'Rwanda',
  ugandan: 'Uganda',
  zimbabwean: 'Zimbabwe',
  employment: 'Employed',
  'employment (salaried)': 'Employed',
  salaried: 'Employed',
  'employed (salaried)': 'Employed',
  'government employee': 'Civil servant',
  'public servant': 'Civil servant',
  'self employed': 'Self-employed',
  'self-employment': 'Self-employed',
  'self employment': 'Self-employed',
  business: 'Business owner',
  'business owner': 'Business owner',
  unemployed: 'Unemployed',
  'not working': 'Unemployed',
  pensioner: 'Retired',
  son: 'Child',
  daughter: 'Child',
  father: 'Parent',
  mother: 'Parent',
  brother: 'Sibling',
  sister: 'Sibling',
  husband: 'Spouse',
  wife: 'Spouse',
  grandfather: 'Grandparent',
  grandmother: 'Grandparent',
  grandson: 'Grandchild',
  granddaughter: 'Grandchild',
  uncle: 'Uncle/Aunt',
  aunt: 'Uncle/Aunt',
  auntie: 'Uncle/Aunt',
  nephew: 'Nephew/Niece',
  niece: 'Nephew/Niece',
}

/** The value at `path` (dots, with numbers for list items) in `record`, or undefined. */
export const readPath = (record, path) => {
  if (!path) return record
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => (value === null || value === undefined ? undefined : value[/^\d+$/.test(key) ? Number(key) : key]), record)
}

const pad = (n) => String(n).padStart(2, '0')

/** A value from a record, cleaned up for a form field; null when there is nothing usable. */
export const tidyValue = (value, tidy, options = null) => {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) value = value.filter((entry) => entry !== null && entry !== undefined).join(', ')
  if (typeof value === 'object') return null
  let text = String(value).trim()
  if (!text) return null
  switch (tidy) {
    case 'phone': {
      const digits = text.replace(/\D/g, '')
      return digits.length >= 9 ? digits.slice(-9) : null
    }
    case 'date': {
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
      if (dmy) return `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`
      return null
    }
    case 'choice': {
      if (!options) return text
      const wanted = SYNONYMS[text.toLowerCase().replace(/\s+/g, ' ')] || text
      return options.find((option) => option.toLowerCase() === wanted.toLowerCase()) || null
    }
    case 'upper':
      return text.toUpperCase()
    case 'lower':
      return text.toLowerCase()
    default:
      return text
  }
}

/**
 * A record through a mapping: { values: { 'personalInfo.firstName': 'Zawadi', … },
 * contacts: { mobile: '+260…', email: '…' } }. Only mapped fields come out.
 */
export const applyMapping = (record, mapping = [], form = 'personal') => {
  const targets = FORM_TARGETS[form] || {}
  const values = {}
  const contacts = {}
  for (const row of mapping) {
    if (!row?.field || !row?.path) continue
    if (row.field === 'contact.mobile') {
      const phone = tidyValue(readPath(record, row.path), 'phone')
      if (phone) contacts.mobile = `+260${phone}`
      continue
    }
    if (row.field === 'contact.email') {
      const email = tidyValue(readPath(record, row.path), 'lower')
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contacts.email = email
      continue
    }
    const target = targets[row.field]
    if (!target) continue
    const value = tidyValue(readPath(record, row.path), row.tidy || 'none', target.options)
    if (value !== null) values[row.field] = value
  }
  return { values, contacts }
}

/** Sets `values` (form paths) into the form's data, only where the form is still empty; the ID always. */
export const fillForm = (data, values, { idField = null, id = null } = {}) => {
  const next = { ...data }
  const set = (path, value, force = false) => {
    const [section, key] = path.split('.')
    if (!section || !key) return
    const current = next[section] || {}
    if (!force && String(current[key] ?? '').trim()) return
    next[section] = { ...current, [key]: value }
  }
  Object.entries(values || {}).forEach(([path, value]) => set(path, value))
  if (idField && id) set(idField, id, true)
  return next
}

/**
 * An earlier application's answers into the form, field by field, only where the form is
 * still empty. Text sections only: documents, collateral and guarantors start afresh.
 */
export const fillEmptySections = (data, previous) => {
  if (!previous) return data
  const next = { ...data }
  for (const [section, values] of Object.entries(previous)) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || ['documents', 'collateral'].includes(section)) continue
    const current = next[section]
    if (!current || typeof current !== 'object' || Array.isArray(current)) continue
    const merged = { ...current }
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string' && value.trim() && !String(current[key] ?? '').trim()) merged[key] = value
    }
    next[section] = merged
  }
  return next
}

/** +260 96…727 / z…@gmail.com: enough for the applicant to recognise, not to learn. */
export const maskMobile = (mobile) => {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-9)
  return digits.length === 9 ? `+260 ${digits.slice(0, 2)}…${digits.slice(-3)}` : null
}
export const maskContactEmail = (email) => {
  const [local, domain] = String(email || '').split('@')
  return local && domain ? `${local[0]}…@${domain}` : null
}

const IZYANE_PERSONAL = [
  ['personalInfo.firstName', 'first_name'],
  ['personalInfo.middleName', 'other_name'],
  ['personalInfo.surname', 'surname'],
  ['personalInfo.phone', 'mobile_number', 'phone'],
  ['personalInfo.email', 'email', 'lower'],
  ['personalInfo.tpin', 'tpin'],
  ['personalInfo.gender', 'gender', 'choice'],
  ['personalInfo.maritalStatus', 'marital_status', 'choice'],
  ['personalInfo.birthDate', 'dob', 'date'],
  ['employmentInfo.nationality', 'nationality', 'choice'],
  ['employmentInfo.residentialAddress', 'residential_address'],
  ['employmentInfo.employerName', 'employer_name'],
  ['employmentInfo.occupation', 'employment_type', 'choice'],
  ['employmentInfo.nextOfKinName', 'next_of_kin'],
  ['employmentInfo.nextOfKinPhone', 'next_of_kin_contact', 'phone'],
  ['employmentInfo.nextOfKinRelationship', 'next_of_kin_relationship', 'choice'],
  ['contact.mobile', 'mobile_number'],
  ['contact.email', 'email'],
].map(([field, path, tidy = 'none']) => ({ field, path, tidy }))

/**
 * Ready-made settings. `standard` is our own format, for an institution that would rather
 * build to it: GET {base}/customers/lookup?id_type=…&id_number=… answering
 * { found: true, customer: { first_name, … } } (or 404), with the same names as iZyane's.
 */
export const KYC_PRESETS = {
  izyane: {
    label: 'iZyane KYC hub',
    settings: {
      lookups: {
        nrc: { enabled: true, method: 'GET', path: '/api/v1/external/customers/lookup/?id_number={id}', body: '' },
        passport: { enabled: true, method: 'GET', path: '/api/v1/external/customers/lookup/?id_number={id}', body: '' },
        tpin: { enabled: false, method: 'GET', path: '', body: '' },
      },
      foundPath: 'status',
      foundValue: 'success',
      recordPath: 'data',
      mappings: { personal: IZYANE_PERSONAL, business: [] },
    },
  },
  standard: {
    label: 'Standard format',
    settings: {
      lookups: {
        nrc: { enabled: true, method: 'GET', path: '/customers/lookup?id_type=nrc&id_number={id}', body: '' },
        passport: { enabled: true, method: 'GET', path: '/customers/lookup?id_type=passport&id_number={id}', body: '' },
        tpin: { enabled: true, method: 'GET', path: '/businesses/lookup?tpin={id}', body: '' },
      },
      foundPath: 'found',
      foundValue: 'true',
      recordPath: 'customer',
      mappings: {
        personal: IZYANE_PERSONAL,
        business: [
          ['businessInfo.companyName', 'company_name'],
          ['businessInfo.brn', 'registration_number'],
          ['businessInfo.businessType', 'legal_form', 'choice'],
          ['businessInfo.establishedDate', 'incorporation_date', 'date'],
          ['businessInfo.natureOfBusiness', 'nature_of_business'],
          ['businessInfo.registeredOffice', 'registered_office'],
          ['directorInfo.applicantEmail', 'email', 'lower'],
          ['directorInfo.applicantPhone', 'phone', 'phone'],
          ['contact.mobile', 'phone'],
          ['contact.email', 'email'],
        ].map(([field, path, tidy = 'none']) => ({ field, path, tidy })),
      },
    },
  },
}

export const DEFAULT_KYC = {
  enabled: false,
  preset: 'custom',
  baseUrl: '',
  timeoutSeconds: 10,
  authType: 'none',
  apiKeyHeader: 'X-API-Key',
  apiKey: '',
  bearerToken: '',
  username: '',
  password: '',
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
  scope: '',
  headers: [],
  lookups: {
    nrc: { enabled: false, method: 'GET', path: '', body: '' },
    passport: { enabled: false, method: 'GET', path: '', body: '' },
    tpin: { enabled: false, method: 'GET', path: '', body: '' },
  },
  foundPath: '',
  foundValue: '',
  recordPath: '',
  mappings: { personal: [], business: [] },
  otherContact: { policy: 'none', fields: [] },
  // How often the public lookup on the start screen may be used, per hour: for one ID, and
  // from one network address. Agents' lookups aren't limited (they're signed in and audited).
  limits: { perIdPerHour: 5, perIpPerHour: 20 },
}

/** The bounds admins may set the lookup limits within. */
export const LOOKUP_LIMIT_RANGE = { min: 1, max: 1000 }
