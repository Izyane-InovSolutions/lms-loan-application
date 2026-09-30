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
  for (const path of ['/admin/applications', '/admin/pipeline', '/admin/rules', '/admin/users', '/admin/roles', '/admin/audit', '/admin/settings', '/admin/health', '/admin/data-requests', '/admin/profile']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('an admin adds a role from an existing one and narrows what it can do', async ({ page }) => {
  await signInAs(page, 'Administrator')
  await page.goto('/admin/roles')
  await page.getByRole('button', { name: 'New role' }).click()
  await page.locator('#new-role-label').fill('Credit analyst')
  await page.locator('#new-role-from').selectOption('loan_officer')
  await page.getByRole('button', { name: 'Add role' }).click()
  await expect(page.getByText('Credit analyst added')).toBeVisible()

  await page.getByLabel('Approve or decline').uncheck()
  await page.getByLabel('Recommend approval or decline').uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Credit analyst saved')).toBeVisible()
  await page.screenshot({ path: 'test-results/roles-page.png', fullPage: true })

  // The new role is offered when inviting someone.
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /Invite/ }).click()
  await expect(page.locator('#invite-role').locator('option', { hasText: 'Credit analyst' })).toHaveCount(1)
})

test('the sales manager can work and decide cases', async ({ page }) => {
  await signInAs(page, 'Sales manager')
  await expect(page.getByRole('link', { name: 'Pipeline' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Team' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await page.goto('/admin/applications?assigned=all')
  await expect(page.getByLabel('Assignment')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New application' })).toBeVisible()
})

test('an admin adds a review stage, which cases then have to pass', async ({ page }) => {
  await signInAs(page, 'Administrator')
  await page.goto('/admin/settings?tab=demo')
  await page.getByRole('button', { name: /Add 60 sample/ }).click()
  await expect(page.getByText(/Added \d+ sample applications/)).toBeVisible({ timeout: 60000 })

  await page.goto('/admin/settings?tab=stages')
  await page.locator('#label-in_review').fill('Assessment')
  await page.getByRole('button', { name: '+ Field verification' }).click()
  await page.screenshot({ path: 'test-results/stages-settings.png', fullPage: true })
  await page.getByRole('button', { name: 'Save the flow' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()

  // The pipeline splits the renamed review column by stage.
  await page.goto('/admin/pipeline')
  await expect(page.getByRole('heading', { name: 'Assessment: Field verification' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Assessment: ready to recommend' })).toBeVisible()

  // A case in review waits on the stage instead of offering "Recommend".
  await page.goto('/admin/applications?status=in_review')
  await page.locator('tbody tr a').first().click()
  await expect(page.getByText('Next: Field verification')).toBeVisible()
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as done' }).click()
  await expect(page.getByText('Field verification done')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recommend' })).toBeVisible()

  // Back to the flow as built, for the tests that follow on this server.
  const { stages } = await (await page.request.get('/api/v1/stages')).json()
  const reset = await page.request.put('/api/v1/settings/stages', { data: { ...stages, labels: {}, review: [], approval: [], closing: [] } })
  expect(reset.ok()).toBe(true)
})
