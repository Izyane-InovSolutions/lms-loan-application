import dayjs from 'dayjs'

const PERSONAL_DOCUMENT_LABELS = {
  payslips: 'Salary Slip',
  bankStatements: 'Bank Statement',
  nrcCopy: 'NRC Copy',
  passportPhoto: 'Passport Photo',
  tpin: 'TPIN Certificate',
}

const BUSINESS_DOCUMENT_LABELS = {
  pacraCertificate: 'PACRA Certificate',
  form2: 'Form 2',
  latestTaxComplianceReturn: 'Latest Tax Compliance Return',
  orderOrInvoice: 'Order/Invoice',
  taxClearance: 'Tax Clearance Certificate',
  bankStatements: 'Bank Statements',
  passportPhoto: 'Passport Photo',
  boardResolution: 'Board Resolution',
}

const toInternationalPhone = (value) => (value ? `+260${value}` : value)

export const buildPersonalPayload = (personalData, uploadedFiles, loanDetails) => {
  const { personalInfo, employmentInfo } = personalData

  const documents = Object.entries(PERSONAL_DOCUMENT_LABELS)
    .filter(([field]) => uploadedFiles[field])
    .map(([field, label]) => ({
      document_for: 'Personal',
      document_name: label,
      file: uploadedFiles[field],
    }))

  return {
    application_type: 'Personal Loan',
    application_date: dayjs().format('YYYY-MM-DD'),
    amount: loanDetails.amount,
    total_amount: loanDetails.totalAmount,
    tenure: String(loanDetails.tenure),
    gender: personalInfo.gender,
    marital_status: personalInfo.maritalStatus,
    nationality: employmentInfo.nationality,
    documents,
    first_name: personalInfo.firstName,
    last_name: personalInfo.surname,
    phone: toInternationalPhone(personalInfo.phone),
    email: personalInfo.email,
    national_registration_card: personalInfo.nrc,
    birth_date: personalInfo.birthDate,
    residential_address: employmentInfo.residentialAddress,
    occupation: employmentInfo.occupation,
    employer_name: employmentInfo.employerName,
    next_of_kin_relationship: employmentInfo.nextOfKinRelationship,
    next_of_kin_name: employmentInfo.nextOfKinName,
    next_of_kin_email: employmentInfo.nextOfKinEmail,
    loan_purpose: employmentInfo.principalObjectiveOfLoan,
    next_of_kin_phone: toInternationalPhone(employmentInfo.nextOfKinPhone),
  }
}

export const buildBusinessPayload = (businessData, uploadedFiles, directorUploadedFiles, loanDetails) => {
  const { businessInfo, directorInfo } = businessData

  const applicantDocuments = Object.entries(BUSINESS_DOCUMENT_LABELS)
    .filter(([field]) => uploadedFiles[field])
    .map(([field, label]) => ({
      document_for: 'Applicant',
      document_name: label,
      file: uploadedFiles[field],
    }))

  const directorDocuments = (directorUploadedFiles || []).flatMap((upload, index) => {
    if (!upload) return []
    const entries = []
    if (upload.nrc) {
      entries.push({ document_for: 'Director', document_name: `Director ${index + 1} NRC`, file: upload.nrc })
    }
    if (upload.passportPhoto) {
      entries.push({ document_for: 'Director', document_name: `Director ${index + 1} Passport Photo`, file: upload.passportPhoto })
    }
    return entries
  })

  return {
    application_type: 'Business Loan',
    application_date: dayjs().format('YYYY-MM-DD'),
    amount: loanDetails.amount,
    total_amount: loanDetails.totalAmount,
    tenure: String(loanDetails.tenure),
    gender: directorInfo.applicantGender,
    marital_status: directorInfo.applicantMaritalStatus,
    nationality: directorInfo.applicantNationality,
    directors: (directorInfo.directors || []).map((director) => ({
      director_name: director.name,
      director_phone: toInternationalPhone(director.phone),
      director_email: director.email,
      national_registration_card: director.nrc,
    })),
    applicant_gender: directorInfo.applicantGender,
    applicant_marital_status: directorInfo.applicantMaritalStatus,
    applicant_nationality: directorInfo.applicantNationality,
    business_documents: [...applicantDocuments, ...directorDocuments],
    company_name: businessInfo.companyName,
    type_of_business: businessInfo.businessType,
    established_date: businessInfo.establishedDate,
    nature_of_business: businessInfo.natureOfBusiness,
    registered_office: businessInfo.registeredOffice,
    collateral_pledged: businessInfo.collateralPledged,
    purpose_of_loan: businessInfo.purposeOfLoan,
    applicant_first_name: directorInfo.applicantFirstName,
    applicant_last_name: directorInfo.applicantLastName,
    applicant_phone: toInternationalPhone(directorInfo.applicantPhone),
    applicant_national_registration_card: directorInfo.applicantNrc,
    applicant_email: directorInfo.applicantEmail,
    applicant_birth_date: directorInfo.applicantBirthDate,
    applicant_address: directorInfo.applicantAddress,
    applicant_position: directorInfo.applicantPosition,
    applicant_middle_name: directorInfo.applicantMiddleName,
  }
}
