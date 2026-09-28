/*
 * Choices and starting values for the application wizard, shared by the page
 * (DashboardPage.tailwind.jsx) and its step screens (WizardSteps.jsx).
 */

export const GENDER_OPTIONS = ['Male', 'Female']
export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Widowed', 'Divorced', 'Separated']
export const NATIONALITY_OPTIONS = ['Kenya', 'Malawi', 'Rwanda', 'Uganda', 'Zambia', 'Zimbabwe']
export const RELATIONSHIP_OPTIONS = [
  'Parent',
  'Sibling',
  'Spouse',
  'Child',
  'Grandparent',
  'Grandchild',
  'Uncle/Aunt',
  'Nephew/Niece',
  'Cousin',
  'Guardian',
  'Friend',
]
export const BUSINESS_TYPE_OPTIONS = [
  'Sole Proprietorship',
  'Partnership',
  'Limited Liability Company (LLC)',
  'Corporation',
]

/** Shared MUI DatePicker styling, mapped onto our design tokens. */

export const personalInitial = {
  personalInfo: {
    firstName: '',
    middleName: '',
    surname: '',
    phone: '',
    email: '',
    nrc: '',
    gender: '',
    maritalStatus: '',
    birthDate: '',
  },
  employmentInfo: {
    residentialAddress: '',
    occupation: '',
    employerName: '',
    nationality: '',
    principalObjectiveOfLoan: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinEmail: '',
    nextOfKinRelationship: '',
  },
  documents: {
    payslips: null,
    bankStatements: null,
    nrcCopy: null,
    passportPhoto: null,
    tpin: null,
  },
}

export const businessInitial = {
  businessInfo: {
    companyName: '',
    businessType: '',
    establishedDate: '',
    natureOfBusiness: '',
    registeredOffice: '',
    collateralPledged: '',
    purposeOfLoan: '',
  },
  directorInfo: {
    directors: [{ name: '', phone: '', email: '', nrc: '' }],
    applicantFirstName: '',
    applicantMiddleName: '',
    applicantLastName: '',
    applicantPhone: '',
    applicantEmail: '',
    applicantNrc: '',
    applicantGender: '',
    applicantMaritalStatus: '',
    applicantBirthDate: '',
    applicantAddress: '',
    applicantPosition: '',
    applicantNationality: '',
  },
  documents: {
    form2: null,
    latestTaxComplianceReturn: null,
    orderOrInvoice: null,
    directorUploads: [{ nrc: null, passportPhoto: null }],
    pacraCertificate: null,
    taxClearance: null,
    bankStatements: null,
    passportPhoto: null,
    boardResolution: null,
  },
}

// Ask for credit bureau consent only where a bureau is connected.
export const CRB_ENABLED = import.meta.env.VITE_CRB_ENABLED === 'true'
