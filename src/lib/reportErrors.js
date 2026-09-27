/*
 * Sends uncaught browser errors to Admin → System health, so problems people hit are
 * visible without asking them for screenshots. At most a few per page load, and never
 * errors from browser extensions (their scripts are not ours).
 */
const MAX_REPORTS = 5
let sent = 0

const fromExtension = (stack = '', source = '') => /chrome-extension:|moz-extension:|safari-extension:/.test(`${stack} ${source}`)

export const reportError = (error, extra = {}) => {
  if (sent >= MAX_REPORTS) return
  const message = String(error?.message || error || 'Unknown error').slice(0, 500)
  const stack = String(error?.stack || '').slice(0, 4000)
  if (fromExtension(stack, extra.source)) return
  sent += 1
  const body = JSON.stringify({ message, stack, url: window.location.href })
  try {
    if (navigator.sendBeacon) navigator.sendBeacon('/api/v1/client-errors', new Blob([body], { type: 'application/json' }))
    else fetch('/api/v1/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {
    // Reporting must never cause an error of its own.
  }
}

export const installErrorReporting = () => {
  if (import.meta.env.DEV && !import.meta.env.VITE_REPORT_DEV_ERRORS) return
  window.addEventListener('error', (event) => reportError(event.error || event.message, { source: event.filename }))
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
}
