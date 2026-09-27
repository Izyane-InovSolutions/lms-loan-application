import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

/*
 * Shared steps for the browser tests. Fields are found by the ids the wizard derives
 * from its validation keys (src/lib/fieldId.js), so tests fill exactly what validation
 * checks.
 */

export const fieldId = (key) => `#field-${key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`

const KV_FILE = path.resolve('.e2e/kv.json')

/** The latest emailed code for an address, read from the test run's local store. */
export const emailedCode = async (email) => {
  let code = null
  await expect
    .poll(() => {
      try {
        code = JSON.parse(fs.readFileSync(KV_FILE, 'utf8'))[`otp:${email}`]?.value?.code || null
      } catch {
        code = null
      }
      return code
    }, { message: `no code emailed to ${email}` })
    .not.toBeNull()
  return code
}

export const SAMPLE_PDF = path.resolve('tests/e2e/fixtures/sample.pdf')

export const fill = (page, key, value) => page.locator(fieldId(key)).fill(value)
export const choose = (page, key) => page.locator(fieldId(key)).selectOption({ index: 1 })

/** Types a date into the MUI picker whose month box is the nth on the page. */
export const typeDate = async (page, mmddyyyy, nth = 0) => {
  await page.getByRole('spinbutton', { name: 'Month' }).nth(nth).click()
  await page.keyboard.type(mmddyyyy)
}

/** Continues to the next step and waits until the step counter has moved on. */
export const next = async (page) => {
  const before = await page.getByText(/Step \d of \d/).first().textContent()
  await page.getByRole('button', { name: /^Continue/ }).click()
  await expect(page.getByText(/Step \d of \d/).first()).not.toHaveText(before)
}

/** Attaches the sample PDF to every document input on the step (not the camera input). */
export const attachAll = async (page) => {
  const inputs = page.locator('input[type=file]:not([capture])')
  await inputs.first().waitFor({ state: 'attached' })
  const count = await inputs.count()
  for (let index = 0; index < count; index += 1) await inputs.nth(index).setInputFiles(SAMPLE_PDF)
  // Each attachment is uploaded to draft storage in the background.
  await page.waitForTimeout(1500)
}

/** Accepts the terms dialog and waits for the confirmation; returns the reference. */
export const acceptTermsAndSubmit = async (page) => {
  await page.getByRole('button', { name: /Submit application/ }).click()
  await page.getByLabel(/I have read and accept/).check()
  await page.getByRole('button', { name: 'Accept and submit' }).click()
  await expect(page.getByText('Application submitted')).toBeVisible({ timeout: 60000 })
  return (await page.getByText(/LOS-\d{4}-\d{6}/).first().textContent()).match(/LOS-\d{4}-\d{6}/)[0]
}

export const signInAs = async (page, roleLabel) => {
  await page.goto('/admin/login')
  await page.getByRole('button', { name: new RegExp(roleLabel) }).click()
  await page.waitForURL('**/admin')
}

/** Signs a customer in on /my-applications with their emailed code. */
export const customerSignIn = async (page, email) => {
  await page.goto('/my-applications')
  await page.locator('#my-email').fill(email)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await page.locator('#my-code').fill(await emailedCode(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
}
