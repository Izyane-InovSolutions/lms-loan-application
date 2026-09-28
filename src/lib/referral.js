/*
 * The referral code from an agent's link (/?ref=CODE), kept for 30 days so an
 * application started later on the same device is still credited to them.
 */
const KEY = 'los_referral'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

export const rememberReferral = (code) => {
  const clean = String(code || '').trim().toUpperCase().slice(0, 20)
  if (!/^[A-Z0-9]{4,20}$/.test(clean)) return null
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: clean, at: Date.now() }))
  } catch {
    // Storage unavailable: the code still applies for this visit via the URL.
  }
  return clean
}

export const readReferral = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (stored && Date.now() - stored.at < TTL_MS) return stored.code
  } catch {
    // Unreadable or unavailable storage: no referral.
  }
  return null
}

export const forgetReferral = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
}
