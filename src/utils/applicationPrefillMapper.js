const emptyPersonalData = () => ({
  personalInfo: {
    firstName: '', middleName: '', surname: '', phone: '', email: '', nrc: '', gender: '', maritalStatus: '', birthDate: '',
  },
  employmentInfo: {
    residentialAddress: '', occupation: '', employerName: '', nationality: '', principalObjectiveOfLoan: '',
    nextOfKinName: '', nextOfKinPhone: '', nextOfKinEmail: '', nextOfKinRelationship: '',
  },
  documents: { payslips: null, bankStatements: null, nrcCopy: null, passportPhoto: null, tpin: null },
})

const emptyBusinessData = () => ({
  businessInfo: {
    companyName: '', businessType: '', establishedDate: '', natureOfBusiness: '', registeredOffice: '', collateralPledged: '', purposeOfLoan: '',
  },
  directorInfo: {
    directors: [{ name: '', phone: '', email: '', nrc: '' }],
    applicantFirstName: '', applicantMiddleName: '', applicantLastName: '', applicantPhone: '', applicantEmail: '', applicantNrc: '',
    applicantGender: '', applicantMaritalStatus: '', applicantBirthDate: '', applicantAddress: '', applicantPosition: '', applicantNationality: '',
    nextOfKinRelationship: '',
  },
  documents: {
    form2: null, latestTaxComplianceReturn: null, orderOrInvoice: null, directorUploads: [{ nrc: null, passportPhoto: null }],
    pacraCertificate: null, taxClearance: null, bankStatements: null, passportPhoto: null, boardResolution: null,
  },
})

const value = (entry) => entry ?? ''

const formPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.startsWith('260') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits
}

const latestFirst = (left, right) => {
  const leftDate = new Date(left.modified || left.creation || left.application_date || 0).getTime()
  const rightDate = new Date(right.modified || right.creation || right.application_date || 0).getTime()
  return rightDate - leftDate
}

export const selectLatestApplication = (applications, loanType) => {
  const applicationType = loanType === 'personal' ? 'Personal Loan' : 'Business Loan'
  return (applications || []).filter((application) => application.application_type === applicationType).sort(latestFirst)[0] || null
}

export const mapApplicationToFormState = (application, loanType) => {
  const loanData = {
    amount: 4000,
    tenure: 6,
  }

  if (loanType === 'personal') {
    const personalData = emptyPersonalData()
    personalData.personalInfo = {
      ...personalData.personalInfo,
      firstName: value(application.first_name),
      middleName: value(application.middle_name),
      surname: value(application.last_name),
      phone: formPhone(application.phone),
      email: value(application.email),
      nrc: value(application.national_registration_card),
      gender: value(application.gender),
      maritalStatus: value(application.marital_status),
      birthDate: value(application.birth_date),
    }
    personalData.employmentInfo = {
      ...personalData.employmentInfo,
      residentialAddress: value(application.residential_address),
      occupation: value(application.occupation),
      employerName: value(application.employer_name),
      nationality: value(application.nationality),
      principalObjectiveOfLoan: value(application.loan_purpose),
      nextOfKinName: value(application.next_of_kin_name),
      nextOfKinPhone: formPhone(application.next_of_kin_phone),
      nextOfKinEmail: value(application.next_of_kin_email),
      nextOfKinRelationship: value(application.next_of_kin_relationship),
    }
    return { loanData, personalData, businessData: emptyBusinessData() }
  }

  const businessData = emptyBusinessData()
  businessData.businessInfo = {
    ...businessData.businessInfo,
    companyName: value(application.company_name),
    businessType: value(application.type_of_business),
    establishedDate: value(application.established_date),
    natureOfBusiness: value(application.nature_of_business),
    registeredOffice: value(application.registered_office),
    collateralPledged: value(application.collateral_pledged),
    purposeOfLoan: value(application.purpose_of_loan),
  }
  businessData.directorInfo = {
    ...businessData.directorInfo,
    directors: (application.directors || []).map((director) => ({
      name: value(director.director_name),
      phone: formPhone(director.director_phone),
      email: value(director.director_email),
      nrc: value(director.national_registration_card),
    })),
    applicantFirstName: value(application.applicant_first_name),
    applicantMiddleName: value(application.applicant_middle_name),
    applicantLastName: value(application.applicant_last_name),
    applicantPhone: formPhone(application.applicant_phone),
    applicantEmail: value(application.applicant_email),
    applicantNrc: value(application.applicant_national_registration_card),
    applicantGender: value(application.applicant_gender),
    applicantMaritalStatus: value(application.applicant_marital_status),
    applicantBirthDate: value(application.applicant_birth_date),
    applicantAddress: value(application.applicant_address),
    applicantPosition: value(application.applicant_position),
    applicantNationality: value(application.applicant_nationality),
    nextOfKinRelationship: value(application.next_of_kin_relationship),
  }
  if (!businessData.directorInfo.directors.length) businessData.directorInfo.directors = [{ name: '', phone: '', email: '', nrc: '' }]
  businessData.documents.directorUploads = businessData.directorInfo.directors.map(() => ({ nrc: null, passportPhoto: null }))
  return { loanData, personalData: emptyPersonalData(), businessData }
}
const documentField = {
  'Salary Slip': 'payslips',
  'Bank Statement': 'bankStatements',
  'NRC Copy': 'nrcCopy',
  'Passport Photo': 'passportPhoto',
  'TPIN Certificate': 'tpin',
  'PACRA Certificate': 'pacraCertificate',
  'Form 2': 'form2',
  'Latest Tax Compliance Return': 'latestTaxComplianceReturn',
  'Order/Invoice': 'orderOrInvoice',
  'Tax Clearance Certificate': 'taxClearance',
  'Bank Statements': 'bankStatements',
  'Board Resolution': 'boardResolution',
}

export const applicationDocumentReferences = (application, loanType) => {
  if (loanType === 'personal') {
    return (application.documents || []).map((document) => ({
      target: `personalData.documents.${documentField[document.document_name] || ''}`,
      label: document.document_name,
      file: document.file,
    })).filter((document) => !document.target.endsWith('.'))
  }

  let directorIndex = 0
  const references = (application.business_documents || []).map((document) => {
    const isDirectorDocument = document.document_for === 'Director'
    const reference = {
      label: document.document_name,
      file: document.file,
      target: isDirectorDocument
        ? `businessData.documents.directorUploads.${directorIndex}.${document.document_name === 'Director NRC' ? 'nrc' : 'passportPhoto'}`
        : `businessData.documents.${documentField[document.document_name] || ''}`,
    }
    if (isDirectorDocument && document.document_name === 'Director Passport Photo') directorIndex += 1
    return reference
  })
  return references.filter((document) => document.target === 'director' || !document.target.endsWith('.'))
}