/**
 * The workspace's look (Settings → Branding → Theme), shared by the browser, which turns it
 * into the colour tokens in src/index.css, and the API, which uses it for emails and
 * generated documents. One accent colour drives everything; the rest are a few choices
 * with safe defaults, so no combination can make the system unreadable.
 */

export const DEFAULT_THEME = {
  // The iZyane globe blue the system shipped with (src/index.css).
  colour: '#1b4f72',
  sidebar: 'brand',
  radius: 'rounded',
  font: 'inter',
}

/** Ready-made accents, each dark enough for white text on buttons. */
export const PRESET_COLOURS = [
  { colour: '#1b4f72', label: 'Ocean blue' },
  { colour: '#1d3a52', label: 'Navy' },
  { colour: '#0f766e', label: 'Teal' },
  { colour: '#166534', label: 'Forest' },
  { colour: '#6d28d9', label: 'Violet' },
  { colour: '#9f1239', label: 'Wine' },
  { colour: '#b45309', label: 'Amber' },
  { colour: '#334155', label: 'Slate' },
]

export const SIDEBAR_STYLES = {
  brand: { label: 'Brand colour', description: 'A deep shade of the accent.' },
  neutral: { label: 'Charcoal', description: 'Near-black, with the accent kept for highlights.' },
}

export const RADIUS_OPTIONS = {
  sharp: { label: 'Sharp', value: '0.25rem', email: 3 },
  rounded: { label: 'Rounded', value: '0.75rem', email: 8 },
  soft: { label: 'Soft', value: '1.1rem', email: 14 },
}

/**
 * Fonts, loaded from Google Fonts when chosen. `email` is the stack mail clients get (most
 * can't load web fonts, so it ends in a close system font); `pdf` is the standard PDF
 * family generated documents use.
 */
export const FONT_OPTIONS = {
  inter: { label: 'Inter', stack: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", google: 'Inter:wght@400;500;600;700;800', email: "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif", pdf: 'sans' },
  manrope: { label: 'Manrope', stack: "'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", google: 'Manrope:wght@400;500;600;700;800', email: "Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif", pdf: 'sans' },
  plex: { label: 'IBM Plex Sans', stack: "'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", google: 'IBM+Plex+Sans:wght@400;500;600;700', email: "'IBM Plex Sans','Helvetica Neue',Helvetica,Arial,sans-serif", pdf: 'sans' },
  serif: { label: 'Source Serif (classic)', stack: "'Source Serif 4', Georgia, 'Times New Roman', serif", google: 'Source+Serif+4:wght@400;500;600;700', email: "'Source Serif 4',Georgia,'Times New Roman',serif", pdf: 'serif' },
  system: { label: 'System default', stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", google: null, email: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", pdf: 'sans' },
}

export const isHexColour = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ''))

/** A saved theme with every gap filled from the defaults, and unknown values dropped. */
export const normaliseTheme = (value = {}) => ({
  colour: isHexColour(value.colour) ? value.colour.toLowerCase() : DEFAULT_THEME.colour,
  sidebar: SIDEBAR_STYLES[value.sidebar] ? value.sidebar : DEFAULT_THEME.sidebar,
  radius: RADIUS_OPTIONS[value.radius] ? value.radius : DEFAULT_THEME.radius,
  font: FONT_OPTIONS[value.font] ? value.font : DEFAULT_THEME.font,
})

/** "#1b4f72" → [hue 0–360, saturation 0–100, lightness 0–100]. */
export const hexToHsl = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, Math.round(lightness * 100)]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return [Math.round(hue * 60), Math.round(saturation * 100), Math.round(lightness * 100)]
}

/** WCAG relative luminance of a hex colour, for choosing readable text on it. */
const luminance = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  const linear = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** Whether white text reads on this colour (otherwise dark text is used on it). */
export const takesWhiteText = (hex) => (1.05 / (luminance(hex) + 0.05)) >= 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * The colour tokens of src/index.css for a theme, light and dark, as "H S% L%" channels.
 * Only tokens that follow the accent are set; status colours (success, warning, danger)
 * keep their meaning whatever the brand.
 */
export const themeTokens = (input) => {
  const theme = normaliseTheme(input)
  const [h, s, l] = hexToHsl(theme.colour)
  const sat = clamp(s, 25, 85)
  const light = {
    '--primary': `${h} ${s}% ${l}%`,
    '--primary-foreground': takesWhiteText(theme.colour) ? '0 0% 100%' : `${h} 45% 10%`,
    '--ring': `${h} ${s}% ${l}%`,
    '--secondary': `${h} ${clamp(sat - 20, 15, 45)}% 96%`,
    '--secondary-foreground': `${h} ${sat}% 22%`,
    '--accent': `${h} ${clamp(sat + 10, 30, 90)}% 94%`,
    '--accent-foreground': `${h} ${sat}% 25%`,
    '--canvas': `${h} ${clamp(sat - 30, 10, 33)}% 96%`,
    '--sidebar': theme.sidebar === 'neutral' ? '220 14% 12%' : `${h} ${clamp(sat, 30, 70)}% 14%`,
    '--radius': RADIUS_OPTIONS[theme.radius].value,
    '--font-sans': FONT_OPTIONS[theme.font].stack,
  }
  const dark = {
    '--primary': `${h} ${clamp(sat, 40, 80)}% 62%`,
    '--primary-foreground': `${h} 45% 8%`,
    '--ring': `${h} ${clamp(sat, 40, 80)}% 62%`,
    '--secondary': `${h} 34% 16%`,
    '--accent': `${h} 34% 18%`,
    '--accent-foreground': `${h} ${clamp(sat + 10, 40, 90)}% 82%`,
    '--secondary-foreground': '210 40% 96%',
    '--sidebar': theme.sidebar === 'neutral' ? '220 14% 7%' : `${h} 45% 9%`,
  }
  return { light, dark }
}

/**
 * The tokens as a stylesheet, to put in the page (and cache for the next first paint). The
 * selectors outrank src/index.css's `:root` and `.dark`, so the theme wins wherever its
 * stylesheet lands — the app's own CSS can load after it, with code split by page. The
 * dark block sets every token the light one does that dark mode needs its own value for.
 */
export const themeCss = (theme) => {
  const { light, dark } = themeTokens(theme)
  const block = (tokens) => Object.entries(tokens).map(([name, value]) => `${name}:${value};`).join('')
  return `html:root{${block(light)}}html:root.dark{${block(dark)}}`
}

/** The Google Fonts stylesheet for a theme's font, or null for the system font. */
export const fontStylesheet = (theme) => {
  const family = FONT_OPTIONS[normaliseTheme(theme).font].google
  return family ? `https://fonts.googleapis.com/css2?family=${family}&display=swap` : null
}
