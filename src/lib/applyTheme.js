import { fontStylesheet, normaliseTheme, themeCss } from '@/config/theme'

/*
 * Puts a theme (src/config/theme.js) on the page: its colour tokens as a stylesheet that
 * overrides src/index.css, its font from Google Fonts, and the browser's tab colour.
 *
 * The stylesheet and font address are also kept in this browser, and index.html applies
 * them before the app loads, so a returning visitor never sees the default colours flash
 * up first. Storage failing only loses that head start.
 */

export const THEME_CSS_KEY = 'los:theme-css'
export const THEME_FONT_KEY = 'los:theme-font'

const ensureElement = (id, tag, attributes) => {
  let element = document.getElementById(id)
  if (!element) {
    element = document.createElement(tag)
    element.id = id
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value))
    document.head.appendChild(element)
  }
  return element
}

/** Applies a theme now. `remember` keeps it for the next first paint (off while previewing). */
export const applyTheme = (input, { remember = true } = {}) => {
  if (typeof document === 'undefined') return
  const theme = normaliseTheme(input)
  const css = themeCss(theme)
  const font = fontStylesheet(theme)

  ensureElement('los-theme', 'style', {}).textContent = css
  const link = ensureElement('los-theme-font', 'link', { rel: 'stylesheet' })
  if (font) {
    if (link.getAttribute('href') !== font) link.setAttribute('href', font)
  } else link.removeAttribute('href')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colour)

  if (!remember) return
  try {
    window.localStorage.setItem(THEME_CSS_KEY, css)
    if (font) window.localStorage.setItem(THEME_FONT_KEY, font)
    else window.localStorage.removeItem(THEME_FONT_KEY)
  } catch {
    // Storage blocked: the theme still applies once the branding has loaded.
  }
}
