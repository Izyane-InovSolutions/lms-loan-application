/**
 * The applicant's answers, grouped and labelled for the case page. Mirrors the wizard's
 * steps so an officer reads it in the order the applicant filled it in.
 */

const phone = (value) => (value ? `+260 ${value}` : '')

export const personalSections = (data) => {
  const info = data?.personalInfo || {}
  const work = data?.employmentInfo || {}
  return [
    {
      title: 'Personal',
      rows: [
        ['Full name', [info.firstName, info.middleName, info.surname].filter(Boolean).join(' ')],
        ['NRC', info.nrc],
        ['Date of birth', info.birthDate],
        ['Gender', info.gender],
        ['Marital status', info.maritalStatus],
        ['Phone', phone(info.phone)],
        ['Email', info.email],
      ],
    },
    {
      title: 'Residence and employment',
      rows: [
        ['Residential address', work.residentialAddress],
        ['Nationality', work.nationality],
        ['Occupation', work.occupation],
        ['Employer', work.employerName],
        ['Purpose of the loan', work.principalObjectiveOfLoan],
      ],
    },
    {
      title: 'Next of kin',
      rows: [
        ['Name', work.nextOfKinName],
        ['Relationship', work.nextOfKinRelationship],
        ['Phone', phone(work.nextOfKinPhone)],
        ['Email', work.nextOfKinEmail],
      ],
    },
  ]
}

export const businessSections = (data) => {
  const business = data?.businessInfo || {}
  const director = data?.directorInfo || {}
  return [
    {
      title: 'Business',
      rows: [
        ['Company', business.companyName],
        ['Type of business', business.businessType],
        ['Established', business.establishedDate],
        ['Nature of business', business.natureOfBusiness],
        ['Registered office', business.registeredOffice],
        ['Collateral pledged', business.collateralPledged],
        ['Purpose of the loan', business.purposeOfLoan],
      ],
    },
    {
      title: 'Applicant',
      rows: [
        ['Full name', [director.applicantFirstName, director.applicantMiddleName, director.applicantLastName].filter(Boolean).join(' ')],
        ['Position', director.applicantPosition],
        ['NRC', director.applicantNrc],
        ['Date of birth', director.applicantBirthDate],
        ['Phone', phone(director.applicantPhone)],
        ['Email', director.applicantEmail],
        ['Address', director.applicantAddress],
        ['Nationality', director.applicantNationality],
      ],
    },
    {
      title: 'Directors',
      rows: (director.directors || []).flatMap((person, index) => [
        [`Director ${index + 1}`, person.name],
        [`Director ${index + 1} NRC`, person.nrc],
        [`Director ${index + 1} contact`, [phone(person.phone), person.email].filter(Boolean).join(', ')],
      ]),
    },
  ]
}

export const sectionsFor = (application) =>
  application.loanType === 'personal' ? personalSections(application.data) : businessSections(application.data)
