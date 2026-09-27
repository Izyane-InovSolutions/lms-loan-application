import { waitUntil } from '@vercel/functions'

/**
 * Runs `task` after the response has been sent — prescreening and the LMS hand-off,
 * which the applicant should not wait for. On Vercel, waitUntil keeps the instance
 * alive until it settles; elsewhere (dev server, tests) it simply runs in the background.
 * Failures are logged; each task records its own outcome.
 */
export const afterResponse = (label, task) => {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[after] ${label} failed: ${error?.message || error}`)
      return import('./errors.js').then(({ reportError }) => reportError({ source: 'background', message: error?.message || String(error), stack: error?.stack, route: label }))
    })
    .catch(() => {})
  try {
    waitUntil(promise)
  } catch {
    // Not inside a Vercel request context.
  }
  return promise
}
