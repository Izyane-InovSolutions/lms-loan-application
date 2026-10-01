import { expect, test } from '@playwright/test'
import { signInAs } from './helpers.js'

/**
 * A native drag and drop the way a hand does it: a few small moves to start the drag, then
 * several over the target, which Chromium needs before it accepts the drop.
 */
const drag = async (page, source, target) => {
  const from = await source.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 5; step += 1) await page.mouse.move(from.x + from.width / 2 + step * 4, from.y + from.height / 2 + step * 4)
  const to = await target.boundingBox()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  for (let step = 1; step <= 3; step += 1) await page.mouse.move(to.x + to.width / 2 + step, to.y + to.height / 2 + step)
  await page.mouse.up()
}


/*
 * The Workflow editor. Last of the browser tests on purpose: publishing from the editor
 * ends the workflow's link to Settings → Stages, which earlier tests rely on.
 */

test('an admin builds the workflow in the editor, and cases follow it', async ({ page, browser }) => {
  // Tall enough that every card is on screen: a drag can't scroll the page as it goes.
  await page.setViewportSize({ width: 1440, height: 2200 })
  await signInAs(page, 'Administrator')
  await page.request.post('/api/v1/demo/seed', { data: { count: 20 } })
  await page.goto('/admin/workflow')
  await expect(page.getByRole('heading', { name: 'Loan application workflow' })).toBeVisible()

  // A new state, set up in its panel: who works on it and where it sends cases.
  await page.getByRole('button', { name: 'Add state' }).click()
  const panel = page.getByRole('dialog')
  await panel.getByLabel('Name', { exact: true }).fill('Underwriting')
  await panel.getByLabel('Sales manager').check()
  await panel.getByLabel('Show as a step on the case').check()
  await panel.getByRole('button', { name: 'Add an action' }).click()
  await panel.getByLabel('Action name').fill('Send to approval')
  await panel.getByLabel('Goes to').selectOption({ label: 'Awaiting approval' })
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Dragging its grip puts it before "Awaiting approval".
  await drag(page, page.locator('article[aria-label="Underwriting"] [title="Drag to reorder"]'), page.locator('article[aria-label="Awaiting approval"]'))
  const order = await page.locator('article h3').allTextContents()
  expect(order.indexOf('Underwriting')).toBe(order.indexOf('Awaiting approval') - 1)

  // Review now recommends to underwriting.
  await page.getByRole('button', { name: 'Edit In review' }).click()
  await panel.getByLabel('Goes to').selectOption({ label: 'Underwriting' })
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Dragging the + onto "Declined" gives underwriting a Reject.
  await drag(page, page.getByRole('button', { name: 'Add an action to Underwriting' }), page.locator('article[aria-label="Declined"]'))
  await expect(page.locator('article[aria-label="Underwriting"]').getByRole('button', { name: /Reject/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Tree preview' }).click()
  await expect(page.getByText('Send to approval')).toBeVisible()
  await page.screenshot({ path: 'test-results/workflow-tree.png', fullPage: true })
  await page.getByRole('tab', { name: 'Flow' }).click()
  await page.screenshot({ path: 'test-results/workflow-flow.png', fullPage: true })

  await page.getByRole('button', { name: 'Save workflow' }).click()
  await expect(page.getByText(/Workflow published/)).toBeVisible()

  // Open cases move to the new version where their state still exists.
  await page.getByRole('button', { name: /Move them to version/ }).click()
  await expect(page.getByText(/cases? moved/)).toBeVisible()

  await page.goto('/admin/pipeline')
  await expect(page.getByRole('heading', { name: 'Underwriting' })).toBeVisible()

  // An officer recommends a case in review; it goes to the sales managers' queue.
  const officer = await browser.newPage()
  await signInAs(officer, 'Loan officer')
  const { applications } = await (await officer.request.get('/api/v1/applications?status=in_review&pageSize=50')).json()
  const target = applications[0]
  for (const check of ['identity', 'documents', 'income']) {
    const { application } = await (await officer.request.get(`/api/v1/applications/${target.id}`)).json()
    await officer.request.post(`/api/v1/applications/${target.id}/actions`, { data: { action: 'check', check, done: true, note: 'Seen', version: application.version } })
  }
  const { application: current } = await (await officer.request.get(`/api/v1/applications/${target.id}`)).json()
  const recommended = await officer.request.post(`/api/v1/applications/${target.id}/actions`, { data: { action: 'transition', actionId: 'recommend', verdict: 'approve', rationale: 'Affordable', version: current.version } })
  expect(recommended.ok(), await recommended.text()).toBe(true)

  const manager = await browser.newPage()
  await signInAs(manager, 'Sales manager')
  await manager.goto('/admin/applications?assigned=queue')
  await manager.locator('tbody tr', { hasText: target.reference }).locator('a').first().click()
  await expect(manager.getByText('Underwriting').first()).toBeVisible()
  await manager.getByRole('button', { name: 'Take the case' }).click()
  await expect(manager.getByText('The case is yours at this stage')).toBeVisible()
  // A recorded step: the case says what's next, and the Stages panel marks it done.
  await expect(manager.getByText('Next: Underwriting')).toBeVisible()
  await manager.getByRole('button', { name: 'Mark as done' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'Mark as done' }).click()
  await expect(manager.getByText('Underwriting done')).toBeVisible()
  await expect(manager.getByText('Awaiting approval').first()).toBeVisible()
})
