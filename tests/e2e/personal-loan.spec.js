import { expect, test } from '@playwright/test'
import { acceptTermsAndSubmit, attachAll, choose, customerSignIn, fill, next, signInAs, typeDate } from './helpers.js'

/*
 * The whole life of a personal loan, as people use it: an applicant arrives through an
 * agent's link and applies; an officer asks for more; the applicant answers; the case is
 * recommended and approved by two different people; the applicant accepts the offer; the
 * loan is marked paid out.
 */

const EMAIL = 'ada.banda@example.com'

test('a referred personal loan goes from application to payout', async ({ browser }) => {
  // Agent and demo accounts exist once someone has used them; open the agent role first.
  const setup = await browser.newPage()
  await signInAs(setup, 'Direct sales agent')
  await setup.close()

  const applicant = await browser.newPage()
  await applicant.goto('/?ref=DEMODSA')
  await expect(applicant.getByText(/applying with Kelvin/)).toBeVisible()

  await applicant.getByRole('button', { name: /Apply/ }).first().click()
  await applicant.locator('#start-email').fill(EMAIL)
  await applicant.getByRole('button', { name: /^Continue$/ }).click()
  await applicant.waitForURL('**/apply/personal/personal-information')

  await fill(applicant, 'personalInfo.firstName', 'Ada')
  await fill(applicant, 'personalInfo.surname', 'Banda')
  await fill(applicant, 'personalInfo.phone', '971234567')
  await fill(applicant, 'personalInfo.nrc', '123456789')
  await choose(applicant, 'personalInfo.gender')
  await choose(applicant, 'personalInfo.maritalStatus')
  await typeDate(applicant, '05011990')
  await next(applicant)

  await fill(applicant, 'employmentInfo.residentialAddress', 'Plot 12, Kabulonga, Lusaka')
  await fill(applicant, 'employmentInfo.occupation', 'Teacher')
  await fill(applicant, 'employmentInfo.employerName', 'Ministry of Education')
  await choose(applicant, 'employmentInfo.nationality')
  await fill(applicant, 'employmentInfo.principalObjectiveOfLoan', 'School fees')
  await fill(applicant, 'employmentInfo.nextOfKinName', 'Bo Banda')
  await fill(applicant, 'employmentInfo.nextOfKinPhone', '971234568')
  await fill(applicant, 'employmentInfo.nextOfKinEmail', 'bo.banda@example.com')
  await choose(applicant, 'employmentInfo.nextOfKinRelationship')
  await next(applicant)

  await attachAll(applicant)
  await next(applicant)
  await next(applicant)

  await applicant.getByLabel(/Share my location/).check()
  const reference = await acceptTermsAndSubmit(applicant)

  // An officer takes it and asks for a clearer payslip.
  const officer = await browser.newPage()
  await signInAs(officer, 'Loan officer')
  await officer.goto(`/admin/applications?q=${reference}&status=all`)
  await officer.getByRole('link', { name: /Ada Banda/ }).first().click()
  await expect(officer.getByText('Brought in by')).toBeVisible()
  await expect(officer.getByText(/Kelvin Mbewe/)).toBeVisible()
  await officer.getByRole('button', { name: 'Start review' }).click()
  await expect(officer.getByText('In review').first()).toBeVisible()
  await officer.getByRole('button', { name: 'Ask the applicant' }).click()
  await officer.locator('#action-message').fill('Please upload a clearer copy of your latest payslip.')
  await officer.getByRole('button', { name: 'Send request' }).click()
  await expect(officer.getByText(/Waiting on the applicant/)).toBeVisible()

  // The applicant answers from their page.
  await customerSignIn(applicant, EMAIL)
  await applicant.getByRole('button', { name: /K4,000 personal loan/ }).click()
  await expect(applicant.getByRole('heading', { name: 'We need something from you' })).toBeVisible()
  await applicant.locator('#reply').fill('Here is a clearer scan.')
  await applicant.getByRole('button', { name: 'Send reply' }).click()
  await expect(applicant.getByText('Here is a clearer scan.')).toBeVisible()

  // The officer verifies and recommends.
  await officer.reload()
  for (const check of ['Identity verified', 'Documents reviewed', 'Income or cash flow verified']) {
    await officer.getByRole('button', { name: new RegExp(`^${check}: not done`) }).click()
    await officer.locator('#action-note').fill('Seen the original')
    await officer.getByRole('button', { name: 'Mark as done' }).click()
    await expect(officer.getByRole('button', { name: new RegExp(`^${check}: done`) })).toBeVisible()
  }
  await officer.getByRole('button', { name: 'Recommend' }).click()
  await officer.locator('#action-rationale').fill('Affordable on verified income.')
  await officer.getByRole('button', { name: 'Recommend approval' }).click()
  await expect(officer.getByText(/a colleague makes the decision/)).toBeVisible()

  // A different person approves.
  const approver = await browser.newPage()
  await signInAs(approver, 'Administrator')
  await approver.goto(officer.url())
  await approver.getByRole('button', { name: 'Decide' }).click()
  await approver.locator('#action-rationale').fill('Agree.')
  await approver.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(approver.getByText(/Waiting for the customer/)).toBeVisible()

  // The applicant accepts the offer.
  await applicant.goto('/my-applications')
  await applicant.getByRole('button', { name: /K4,000 personal loan/ }).click()
  await expect(applicant.getByRole('heading', { name: 'Your loan offer' })).toBeVisible()
  await applicant.getByLabel(/I accept this loan/).check()
  await applicant.getByRole('button', { name: 'Accept the offer' }).click()
  await expect(applicant.getByText('Offer accepted').first()).toBeVisible()

  // And it is paid out.
  await approver.reload()
  await approver.getByRole('button', { name: 'Mark as paid out' }).click()
  await approver.getByRole('dialog').getByRole('button', { name: 'Mark as paid out' }).click()
  await expect(approver.getByText('Disbursed').first()).toBeVisible()
})
