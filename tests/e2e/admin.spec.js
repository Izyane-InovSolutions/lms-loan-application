import { expect, test } from '@playwright/test'
import { signInAs } from './helpers.js'

test('an admin changes loan pricing and the public site shows it', async ({ page, browser }) => {
  await signInAs(page, 'Administrator')
  await page.goto('/admin/settings?tab=products')
  await page.locator('#personal-rate').fill('7')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()

  const visitor = await browser.newPage()
  await visitor.goto('/#loans')
  await expect(visitor.getByText('7% flat').first()).toBeVisible()
})

test('an admin publishes new terms, which applicants then see', async ({ page, browser }) => {
  await signInAs(page, 'Administrator')
  await page.goto('/admin/settings?tab=legal')
  await expect(page.getByText(/placeholder wording/)).toBeVisible()
  await page.locator('#legal-title').fill('Loan agreement')
  await page.locator('#legal-body').fill('## Your loan\n- You agree to repay on time.\n\nThese are the approved terms for testing.')
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText(/Version 2 is now what applicants see/)).toBeVisible()

  const response = await (await browser.newPage()).request.get('/api/v1/legal/terms')
  expect((await response.json()).version).toBe(2)
})

test('credit rules can be tried on recent applications before publishing', async ({ page }) => {
  await signInAs(page, 'Administrator')
  await page.goto('/admin/settings?tab=demo')
  await page.getByRole('button', { name: /Add 60 sample/ }).click()
  await expect(page.getByText(/Added \d+ sample applications/)).toBeVisible({ timeout: 60000 })
  await page.goto('/admin/rules')
  await page.getByRole('button', { name: 'Try on recent applications' }).click()
  await expect(page.getByText('Trial run')).toBeVisible()
  await expect(page.getByText(/prescreened applications, replayed/)).toBeVisible()
})

test('every role’s dashboard renders without errors', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signInAs(page, 'Administrator')
  for (const role of ['Officer', 'Sales', 'RM', 'DSA', 'Admin']) {
    await page.getByRole('radio', { name: new RegExp(`^${role}`) }).click()
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible()
  }
  for (const path of ['/admin/applications', '/admin/pipeline', '/admin/rules', '/admin/users', '/admin/audit', '/admin/settings', '/admin/health', '/admin/data-requests', '/admin/profile']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
  }
  expect(errors).toEqual([])
})
