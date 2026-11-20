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
  brand: { label: 'Brand colour', description: 'A deep shade of the accent that keeps its colour.' },
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

/** [hue, saturation %, lightness %] → "#rrggbb". */
const hslToHex = (h, s, l) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const channel = (n) => {
    const k = (n + h / 30) % 12
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Walks a colour's lightness one step at a time (darker with step -1, lighter with +1)
 * until it reaches `ratio` against `background`, keeping hue and saturation. Returns the
 * lightness, so a colour that already reads stays exactly as it is.
 */
const readableLightness = (h, s, from, background, ratio, step) => {
  let light = from
  while (light > 5 && light < 95 && contrast(hslToHex(h, s, light), background) < ratio) light += step
  return light
}

/** Orange through yellow: hues that turn brown, not deeper, when darkened. */
const isWarm = (h) => h >= 15 && h <= 65

/**
 * Lightness of the "Brand colour" sidebar. Cool accents take a deep 20% shade, which still
 * reads as the colour. Warm ones would go brown there, so they're darkened only as far as
 * white nav text needs (5.5:1, so the dimmed labels still read), capped at 32%.
 */
const sidebarLightness = (h, s, l) =>
  isWarm(h) ? readableLightness(h, s, Math.min(l, 32), '#ffffff', 5.5, -1) : readableLightness(h, s, Math.min(l, 20), '#ffffff', 5.5, -1)

/** Text for a fill: white, or a near-black of the accent, whichever reads better on it. */
const textOn = (h, hex) => (contrast(hex, '#ffffff') >= contrast(hex, hslToHex(h, 45, 8)) ? '0 0% 100%' : `${h} 45% 8%`)

/**
 * The colour tokens of src/index.css for a theme, light and dark, as "H S% L%" channels.
 * Only tokens that follow the accent are set; status colours (success, warning, danger)
 * keep their meaning whatever the brand.
 *
 * The accent is used as is wherever it can be. A fill (`--primary`) is the exact colour in
 * light mode, and in dark mode too unless it would vanish on the dark page (under 3:1), when
 * it's lightened just enough. Text in the accent (`--primary-text`, what `text-primary`
 * uses) is shaded separately until it reads (4.8:1 on the page), so a light accent such as
 * orange still gives legible links. Greys and dark surfaces carry a hint of the accent's
 * hue instead of a fixed blue, softer for warm hues so they don't read as brown.
 */
export const themeTokens = (input) => {
  const theme = normaliseTheme(input)
  const [h, s, l] = hexToHsl(theme.colour)
  const sat = clamp(s, 25, 85)
  // How strongly the accent's hue tints the neutrals.
  const tint = isWarm(h) ? clamp(Math.round(s * 0.25), 6, 20) : clamp(Math.round(s * 0.6), 8, 40)

  const secondaryBg = hslToHex(h, clamp(sat - 20, 15, 45), 96)
  const accentBg = hslToHex(h, clamp(sat + 10, 30, 90), 94)
  // Light-mode text is checked on the admin canvas, the tinted page behind cards.
  const canvas = hslToHex(h, clamp(sat - 30, 10, 33), 96)
  const lightText = readableLightness(h, s, l, canvas, 4.8, -1)
  const mutedTint = clamp(Math.round(tint / 2), 5, 16)
  const sidebar = theme.sidebar === 'neutral' ? '220 14% 12%' : `${h} ${s}% ${sidebarLightness(h, s, l)}%`
  const light = {
    '--primary': `${h} ${s}% ${l}%`,
    '--primary-foreground': takesWhiteText(theme.colour) ? '0 0% 100%' : `${h} 45% 10%`,
    '--primary-text': `${h} ${s}% ${lightText}%`,
    '--ring': `${h} ${s}% ${l}%`,
    '--foreground': `${h} ${clamp(tint, 6, 30)}% 11%`,
    '--card-foreground': `${h} ${clamp(tint, 6, 30)}% 11%`,
    '--popover-foreground': `${h} ${clamp(tint, 6, 30)}% 11%`,
    '--secondary': `${h} ${clamp(sat - 20, 15, 45)}% 96%`,
    '--secondary-foreground': `${h} ${s}% ${readableLightness(h, s, Math.min(lightText, 26), secondaryBg, 7, -1)}%`,
    '--muted': `${h} ${tint}% 96%`,
    '--muted-foreground': `${h} ${mutedTint}% ${readableLightness(h, mutedTint, 46, canvas, 4.6, -1)}%`,
    '--accent': `${h} ${clamp(sat + 10, 30, 90)}% 94%`,
    '--accent-foreground': `${h} ${s}% ${readableLightness(h, s, Math.min(lightText, 28), accentBg, 6.5, -1)}%`,
    '--border': `${h} ${clamp(tint, 8, 32)}% 91%`,
    '--input': `${h} ${clamp(tint, 8, 32)}% 91%`,
    '--canvas': `${h} ${clamp(sat - 30, 10, 33)}% 96%`,
    '--sidebar': sidebar,
    // The active-page marker in the sidebar: a light tint of the accent, so it reads on
    // both the brand and the charcoal sidebar.
    '--sidebar-marker': `${h} ${clamp(s, 60, 100)}% 72%`,
    '--radius': RADIUS_OPTIONS[theme.radius].value,
    '--font-sans': FONT_OPTIONS[theme.font].stack,
  }

  const card = hslToHex(h, tint, 10)
  const accentDark = hslToHex(h, tint, 18)
  const fillL = readableLightness(h, s, l, card, 3, 1)
  const darkText = readableLightness(h, s, Math.max(l, fillL), card, 4.8, 1)
  const dark = {
    '--background': `${h} ${tint}% 7%`,
    '--foreground': `${h} ${clamp(tint, 6, 25)}% 95%`,
    '--card': `${h} ${tint}% 10%`,
    '--card-foreground': `${h} ${clamp(tint, 6, 25)}% 95%`,
    '--popover': `${h} ${tint}% 10%`,
    '--popover-foreground': `${h} ${clamp(tint, 6, 25)}% 95%`,
    '--primary': `${h} ${s}% ${fillL}%`,
    '--primary-foreground': textOn(h, hslToHex(h, s, fillL)),
    '--primary-text': `${h} ${s}% ${darkText}%`,
    '--ring': `${h} ${s}% ${fillL}%`,
    '--secondary': `${h} ${tint}% 16%`,
    '--secondary-foreground': `${h} ${clamp(tint, 6, 25)}% 95%`,
    '--muted': `${h} ${tint}% 16%`,
    '--muted-foreground': `${h} ${clamp(Math.round(tint / 2), 5, 20)}% 68%`,
    '--accent': `${h} ${tint}% 18%`,
    '--accent-foreground': `${h} ${s}% ${readableLightness(h, s, Math.max(darkText, 75), accentDark, 7, 1)}%`,
    '--border': `${h} ${tint}% 20%`,
    '--input': `${h} ${tint}% 20%`,
    // Warm accents keep their light-mode shade (darker would be brown); cool ones go deeper.
    '--sidebar': theme.sidebar === 'neutral' ? '220 14% 7%' : isWarm(h) ? sidebar : `${h} ${clamp(s, 30, 70)}% 12%`,
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
