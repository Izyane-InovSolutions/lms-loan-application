import { expect, test } from '@playwright/test'
import { acceptTermsAndSubmit, attachAll, choose, emailedCode, fill, next, signInAs, typeDate } from './helpers.js'

/** Fills the two business steps; the documents step and after are left to the caller. */
const fillBusiness = async (page, { email, company }) => {
  await fill(page, 'businessInfo.companyName', company)
  await choose(page, 'businessInfo.businessType')
  await typeDate(page, '03012015')
  await fill(page, 'businessInfo.natureOfBusiness', 'Retail')
  await fill(page, 'businessInfo.registeredOffice', 'Cairo Road, Lusaka')
  await fill(page, 'businessInfo.collateralPledged', 'Delivery vehicle')
  await fill(page, 'businessInfo.purposeOfLoan', 'Fund a supply order')
  await next(page)

  await fill(page, 'directorInfo.directors[0].name', 'Mutale Chanda')
  await fill(page, 'directorInfo.directors[0].phone', '971234569')
  await fill(page, 'directorInfo.directors[0].email', 'mutale.chanda@example.com')
  await fill(page, 'directorInfo.directors[0].nrc', '234567891')
  await fill(page, 'directorInfo.applicantFirstName', 'Mutale')
  await fill(page, 'directorInfo.applicantLastName', 'Chanda')
  await fill(page, 'directorInfo.applicantPhone', '971234569')
  await fill(page, 'directorInfo.applicantEmail', email)
  await fill(page, 'directorInfo.applicantNrc', '234567891')
  await typeDate(page, '06011985')
  await choose(page, 'directorInfo.applicantGender')
  await choose(page, 'directorInfo.applicantMaritalStatus')
  await fill(page, 'directorInfo.applicantAddress', 'Roma, Lusaka')
  await fill(page, 'directorInfo.applicantPosition', 'Director')
  await choose(page, 'directorInfo.applicantNationality')
  await next(page)

  await attachAll(page)
  await next(page)
  await next(page)
}

test('a business applies online and the case shows its directors and documents', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Start a business loan/ }).click()
  await page.locator('#start-email').fill('mutale@kafueagro.com')
  await page.getByRole('button', { name: /^Continue$/ }).click()
  await page.waitForURL('**/apply/business/business-information')
  await fillBusiness(page, { email: 'mutale@kafueagro.com', company: 'Kafue Agro Supplies' })
  const reference = await acceptTermsAndSubmit(page)

  const officer = await browser.newPage()
  await signInAs(officer, 'Loan officer')
  await officer.goto(`/admin/applications?q=${reference}&status=all`)
  await officer.getByRole('link', { name: /Kafue Agro Supplies/ }).first().click()
  await expect(officer.getByText('Director 1 NRC').first()).toBeVisible()
  await officer.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: /^Documents/ }).click()
  await expect(officer.getByText('PACRA certificate')).toBeVisible()
  await expect(officer.getByText('Director 1 passport photo')).toBeVisible()
})

test('an agent fills in an application with a customer, who confirms with a code', async ({ page }) => {
  await signInAs(page, 'Direct sales agent')
  await page.goto('/admin/applications')
  await page.getByRole('button', { name: 'New application' }).first().click()
  await page.waitForURL('**/apply/personal/**')
  await expect(page.getByText(/filling this in for a customer/)).toBeVisible()

  // The agent switches to a business loan by editing the URL's type the way the wizard does.
  await page.goto('/apply/business/business-information')
  const customer = 'owner@chisokonehardware.com'
  await fillBusiness(page, { email: customer, company: 'Chisokone Hardware' })

  await expect(page.getByText('The customer’s agreement')).toBeVisible()
  await page.getByRole('button', { name: 'Email the code' }).click()
  await page.getByLabel('Customer’s code').fill(await emailedCode(customer))
  await page.getByRole('button', { name: /Submit application/ }).click()
  await page.getByLabel(/I have read and accept/).check()
  await page.getByRole('button', { name: 'Accept and submit' }).click()
  await page.getByRole('button', { name: 'Open the case' }).click()
  await page.waitForURL('**/admin/applications/**')
  await expect(page.getByText(/Chisokone Hardware/).first()).toBeVisible()
  await expect(page.getByText(/direct sales agent/i).first()).toBeVisible()
})

test('an RM can choose a business loan when starting an assisted application', async ({ page }) => {
  await signInAs(page, 'Relationship manager')
  await page.goto('/admin/applications')
  await page.getByRole('button', { name: 'New application' }).first().click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Personal loan' })).toBeVisible()
  await page.getByRole('button', { name: 'Business loan' }).click()
  await page.waitForURL('**/apply/business/business-information')
  await expect(page.getByText(/filling this in for a customer/)).toBeVisible()
})
