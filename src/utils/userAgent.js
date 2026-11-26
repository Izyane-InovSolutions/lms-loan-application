/*
 * A browser's User-Agent in plain words, for the audit log: which browser (and its major
 * version), on which system, on what kind of device. Best effort: a browser can say what
 * it likes, so this describes what it claimed, and the raw string is kept beside it.
 */

const BROWSERS = [
  // Order matters: Edge, Opera and Samsung Internet also say "Chrome"; Chrome also says "Safari".
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /(?:OPR|Opera)\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//],
  ['curl', /^curl\/(\d+)/],
  ['Postman', /PostmanRuntime\/(\d+)/],
  ['Node.js', /node(?:-fetch)?\/?(\d+)?/i],
]

const systemOf = (ua) => {
  if (/iPad/.test(ua)) return 'iPadOS'
  if (/iPhone|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS'
  if (/Linux|X11/.test(ua)) return 'Linux'
  return null
}

const deviceOf = (ua, browser) => {
  if (['curl', 'Postman', 'Node.js'].includes(browser) || !/Mozilla\//.test(ua)) return 'Script or tool'
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'Tablet'
  if (/Mobi|iPhone|iPod/.test(ua)) return 'Phone'
  return 'Computer'
}

/** { browser, os, device, label } for a User-Agent, or null when there is none. */
export const describeUserAgent = (userAgent) => {
  const ua = String(userAgent || '').trim()
  if (!ua) return null
  let browser = null
  for (const [name, pattern] of BROWSERS) {
    const match = ua.match(pattern)
    if (match) {
      browser = match[1] ? `${name} ${match[1]}` : name
      break
    }
  }
  const name = browser?.replace(/ \d+$/, '')
  const os = systemOf(ua)
  const device = deviceOf(ua, name)
  const label = [browser || 'Unknown browser', os ? `on ${os}` : null].filter(Boolean).join(' ') + `, ${device.toLowerCase()}`
  return { browser, os, device, label }
}
