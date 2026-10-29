/*
 * Choices and starting values for the application wizard, shared by the page
 * (DashboardPage.tailwind.jsx) and its step screens (WizardSteps.jsx).
 */

import { BUSINESS_STRUCTURES } from '@/config/applicantRules'

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
// The legal forms, from applicantRules.js, which says what each one is asked for.
export const BUSINESS_TYPE_OPTIONS = BUSINESS_STRUCTURES.map((entry) => entry.value)

/** Shared MUI DatePicker styling, mapped onto our design tokens. */

export const personalInitial = {
  personalInfo: {
    firstName: '',
    middleName: '',
    surname: '',
    phone: '',
    email: '',
    nrc: '',
    tpin: '',
    // In place of the NRC, for applicants who aren't Zambian.
    passportNumber: '',
    zraVerifiedName: '',
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
    // A product's own documents, by key (slot custom.<key>), and one proof per collateral item.
    custom: {},
    collateral: [],
  },
  // What is pledged, when the product asks for collateral (src/config/collateral.js).
  collateral: { items: [] },
}

export const businessInitial = {
  businessInfo: {
    companyName: '',
    tpin: '',
    brn: '',
    zraVerifiedName: '',
    businessType: '',
    establishedDate: '',
    natureOfBusiness: '',
    registeredOffice: '',
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
    applicantPassportNumber: '',
    applicantGender: '',
    applicantMaritalStatus: '',
    applicantBirthDate: '',
    applicantAddress: '',
    applicantPosition: '',
    // What they typed when the position is "Other".
    applicantPositionOther: '',
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
    custom: {},
    collateral: [],
  },
  collateral: { items: [] },
}

// Ask for credit bureau consent only where a bureau is connected.
export const CRB_ENABLED = import.meta.env.VITE_CRB_ENABLED === 'true'
