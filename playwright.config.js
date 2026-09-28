import { defineConfig } from '@playwright/test'

/*
 * Browser tests of the real app: `npm run test:e2e`.
 *
 * The dev server runs in "e2e" mode (.env.e2e): an in-memory database, local stores in
 * .e2e/, no email, no AI, demo sign-in on. Locally the installed Google Chrome is used,
 * so nothing is downloaded; CI installs Playwright's Chromium instead.
 */
const PORT = 4317

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1280, height: 900 },
    geolocation: { latitude: -15.4167, longitude: 28.2833, accuracy: 25 },
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `rm -rf .e2e && npx vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
