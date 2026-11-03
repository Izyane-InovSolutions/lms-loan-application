/**
 * The applicant's answers, grouped and labelled for the case page. Mirrors the wizard's
 * steps so an officer reads it in the order the applicant filled it in.
 */

import { guarantorsOf } from '@/config/guarantors'
import { collateralItems, collateralLendingValue, collateralValue, describeTerms, itemLabel, lendingValue, pledgeTerms } from '@/config/collateral'
import { employerField, positionLabel } from '@/config/applicantRules'
import { formatKwacha } from '@/config/loanProducts'

const phone = (value) => (value ? `+260 ${value}` : '')

export const personalSections = (data) => {
  const info = data?.personalInfo || {}
  const work = data?.employmentInfo || {}
  return [
    {
      title: 'Personal',
      rows: [
        ['Full name', [info.firstName, info.middleName, info.surname].filter(Boolean).join(' ')],
        info.passportNumber && !info.nrc ? ['Passport number', info.passportNumber] : ['NRC', info.nrc],
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
        // A business name for the self-employed; nothing for those without an employer.
        [employerField(work.occupation)?.label || 'Employer', work.employerName],
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
        ['Position', positionLabel(director)],
        director.applicantPassportNumber && !director.applicantNrc ? ['Passport number', director.applicantPassportNumber] : ['NRC', director.applicantNrc],
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

/** What was pledged, one row per item with what can be lent against it, then the totals and how they compare with the loan. */
export const collateralSection = (application, catalog) => {
  const items = collateralItems(application.data)
  if (!items.length) return []
  const total = collateralValue(items)
  const lending = collateralLendingValue(items, catalog)
  const ofLoan = (value) => (application.amount ? ` (${Math.round((value / application.amount) * 100)}% of the loan)` : '')
  return [
    {
      title: 'Collateral',
      rows: [
        ...items.map((item) => [
          `${itemLabel(item, catalog)}${item.code ? ` · ${item.code}` : ''}`,
          [
            String(item.description || '').trim(),
            Number(item.value) > 0 ? `est. ${formatKwacha(item.value)}, lending value ${formatKwacha(lendingValue(item, catalog))} (${describeTerms(pledgeTerms(item, catalog))})` : '',
          ]
            .filter(Boolean)
            .join(', '),
        ]),
        ['Total pledged', `${formatKwacha(total)}${ofLoan(total)}`],
        ['Total lending value', `${formatKwacha(lending)}${ofLoan(lending)}`],
      ],
    },
  ]
}

/** The guarantors named, one row each. */
export const guarantorSection = (application) => {
  const people = guarantorsOf(application.data)
  if (!people.length) return []
  return [
    {
      title: 'Guarantors',
      rows: people.map((person, index) => [
        `Guarantor ${index + 1}`,
        [person.name, `NRC ${person.nrc}`, person.relationship, phone(person.phone), person.email, person.address].filter(Boolean).join(', '),
      ]),
    },
  ]
}

export const sectionsFor = (application, catalog) => [
  ...(application.loanType === 'personal' ? personalSections(application.data) : businessSections(application.data)),
  ...collateralSection(application, catalog),
  ...guarantorSection(application),
]
