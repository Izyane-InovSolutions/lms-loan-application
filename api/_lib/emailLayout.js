import crypto from 'node:crypto'
import { getBranding, getLetterhead } from './branding.js'
import { hasTransparentBackground } from './imageAlpha.js'

/*
 * The one look every email shares, styled like the lender's letterhead: a full-width block
 * of the brand colour with the logo and a large brand name, the subject set light at its
 * foot; the message on a soft tint of the same colour, signed off by the team; and a
 * centred footer with the logo, name and contacts (Settings → Branding).
 *
 * Built from tables and inline styles, which is what email clients reliably draw; a
 * <style> block adds hover states, a phone layout and a dark theme where the client
 * supports them, and nothing depends on it. Every colour is worked out from the one brand
 * colour, so a lender's emails match their documents.
 *
 * The logo travels inside the email (a cid: attachment), so it shows without the client
 * fetching anything from the workspace.
 */

const LOGO_CID = 'brand-logo'

// Whether each logo seen so far has a see-through background, by its fingerprint: worked
// out once per logo rather than once per email.
const transparency = new Map()
const isTransparent = (logo) => {
  const key = crypto.createHash('sha1').update(logo.bytes).digest('hex')
  if (!transparency.has(key)) transparency.set(key, hasTransparentBackground(logo.bytes, logo.contentType))
  return transparency.get(key)
}
const FALLBACK_COLOUR = '#1f4e79'
const FONT = "'Helvetica Neue',Helvetica,Arial,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const colourOf = (value) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : FALLBACK_COLOUR)

/** The brand colour mixed with white (`amount` > 0) or black (< 0). */
const mixed = (hex, amount) => {
  const value = parseInt(hex.slice(1), 16)
  const toward = amount >= 0 ? 255 : 0
  const share = Math.abs(amount)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.round(channel + (toward - channel) * share))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** The palette every piece draws from, all from the brand colour. */
const paletteOf = (colour) => ({
  colour,
  ink: mixed(colour, -0.25), // headings and body text: the brand colour, deepened
  soft: mixed(colour, 0.35), // secondary text
  page: mixed(colour, 0.88), // the background the message sits on
  panel: mixed(colour, 0.94), // panels a shade lighter than the page
  line: mixed(colour, 0.75), // dividers and borders
  onBrand: mixed(colour, 0.9), // text on the brand-coloured header
  accent: mixed(colour, 0.14), // the decorative shapes in the header
})

// ---------------------------------------------------------------------------
// Pieces a message is made of. Each is HTML, or a function of the palette.
// ---------------------------------------------------------------------------

export const paragraph = (text, { muted = false } = {}) => ({ ink, soft }) =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${muted ? soft : ink}">${escapeHtml(text)}</p>`

/** A one-time code, large and spaced so it's easy to read out or type, with how long it lasts. */
export const codeBlock = (code, { expires = 'Expires in 10 minutes' } = {}) => ({ ink, soft, panel, line }) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px">
    <tr><td class="tile" align="center" style="background:${panel};border:1px solid ${line};border-radius:4px;padding:24px 16px">
      <div class="code" style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:12px;color:${ink};user-select:all;-webkit-user-select:all">${escapeHtml(code)}</div>
      <div style="margin-top:10px;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:${soft}">${escapeHtml(expires)}</div>
    </td></tr>
  </table>`

/** A list of items, each with an optional tag on the right ("To sign"). */
export const itemList = (items) => ({ colour, ink, panel, line, onBrand }) =>
  `<table role="presentation" class="list" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;background:${panel};border:1px solid ${line};border-radius:4px;border-collapse:separate">
    ${items
      .map(
        (item, index) => `<tr><td style="padding:14px 18px;${index ? `border-top:1px solid ${line};` : ''}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:15px;color:${ink}"><span style="display:inline-block;width:7px;height:7px;background:${colour};margin-right:12px;vertical-align:middle"></span>${escapeHtml(item.label)}</td>
            ${item.badge ? `<td align="right" style="white-space:nowrap"><span style="display:inline-block;padding:4px 10px;border-radius:2px;background:${colour};color:${onBrand};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase">${escapeHtml(item.badge)}</span></td>` : ''}
          </tr></table>
        </td></tr>`
      )
      .join('')}
  </table>`

/** Label and value pairs, such as a reference, in a quiet panel. */
export const details = (rows) => ({ ink, soft, panel, line }) =>
  `<table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;background:${panel};border:1px solid ${line};border-radius:4px">
    ${rows
      .map(
        ([label, value], index) => `<tr>
          <td style="padding:12px 18px;${index ? `border-top:1px solid ${line};` : ''}font-size:13px;color:${soft};width:40%">${escapeHtml(label)}</td>
          <td style="padding:12px 18px;${index ? `border-top:1px solid ${line};` : ''}font-size:14px;color:${ink};font-weight:700">${escapeHtml(value)}</td>
        </tr>`
      )
      .join('')}
  </table>`

/** A short notice set apart: a security warning, or what happens next. */
export const notice = (text, { tone = 'info' } = {}) => ({ colour, ink, panel }) => {
  const edge = tone === 'warning' ? '#d97706' : colour
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px">
    <tr><td class="notice" style="background:${panel};border-left:4px solid ${edge};padding:14px 16px;font-size:14px;line-height:1.55;color:${ink}">${escapeHtml(text)}</td></tr>
  </table>`
}

/** The main action, as a button drawn so Outlook shows it too, with the link to copy beneath. */
const button = ({ label, url }, { colour, onBrand, soft }) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 6px">
    <tr><td class="button" align="center" bgcolor="${colour}" style="background:${colour};border-radius:3px">
      <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:0.3px;color:${onBrand};text-decoration:none">${escapeHtml(label)}&nbsp;&nbsp;&rarr;</a>
    </td></tr>
  </table>
  <p class="muted" style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${soft}">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:${soft};text-decoration:underline;word-break:break-all">${escapeHtml(url)}</a></p>`

// ---------------------------------------------------------------------------
// The whole message
// ---------------------------------------------------------------------------

/**
 * Builds one email. `blocks` are the pieces above; `action` is the button, { label, url };
 * `eyebrow` is set in the header, `title` opens the message. Returns nodemailer's
 * { html, attachments } — the logo, inline — to spread into sendMail beside the plain text.
 */
export const renderEmail = async ({ preheader = '', eyebrow = '', title, blocks = [], action = null, footnote = '', signOff = true }) => {
  const [branding, letterhead] = await Promise.all([getBranding().catch(() => ({})), getLetterhead().catch(() => null)])
  const brand = branding.name || 'Loan Origination'
  const palette = paletteOf(colourOf(branding.colour))
  const { colour, ink, soft, page, line, onBrand, accent } = palette
  const logo = letterhead?.logo
  const body = blocks.map((block) => (typeof block === 'function' ? block(palette) : block)).join('\n')
  const contacts = [branding.email, branding.phone, branding.website].filter(Boolean)
  const website = branding.website ? (/^https?:\/\//i.test(branding.website) ? branding.website : `https://${branding.website}`) : null
  // A logo with a see-through background sits straight on the colour behind it; one with a
  // solid background gets a white tile with rounded corners, so its edges look intended.
  const seeThrough = logo ? isTransparent(logo) : false
  const logoImage = (size, radius) =>
    logo
      ? `<img src="cid:${LOGO_CID}" alt="" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;object-fit:contain;${seeThrough ? '' : `border-radius:${radius}px;background:#ffffff;padding:${Math.round(size / 12)}px;`}">`
      : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  .button:hover { filter: brightness(1.15); }
  a:hover { opacity: 0.85; }
  @media (max-width: 620px) {
    .header { padding: 28px 22px 22px !important; }
    .brand { font-size: 30px !important; }
    .shape { display: none !important; }
    .content { padding: 32px 22px 8px !important; }
    .closing { padding: 26px 22px 8px !important; }
    .footer { padding: 30px 22px 36px !important; }
    .code { font-size: 28px !important; letter-spacing: 8px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .page, .content, .closing, .footer { background: #0b1220 !important; }
    .content p, .content td, .content h1, .closing p, .footer p, .footer td { color: #e2e8f0 !important; }
    .panel, .tile, .list, .notice { background: #111a2e !important; border-color: #24324d !important; }
    .panel td, .list td { border-color: #24324d !important; }
    .code { color: #f8fafc !important; }
    .muted, .muted a, .footer a { color: #94a3b8 !important; }
    .rule { border-color: #24324d !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${page}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader || title)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
  <table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" style="background:${page};font-family:${FONT}">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">

        <!-- Header: the brand colour, logo and name, the subject at its foot -->
        <tr><td class="header" bgcolor="${colour}" style="background:${colour};padding:36px 40px 26px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${
              logo
                ? `<td width="90" style="vertical-align:middle;padding-right:18px">${logoImage(72, 12)}</td>`
                : ''
            }
            <td style="vertical-align:middle">
              <div class="brand" style="font-size:40px;line-height:1.02;font-weight:800;letter-spacing:-1px;color:${onBrand}">${escapeHtml(brand)}</div>
            </td>
            <td class="shape" width="70" align="right" style="vertical-align:top">
              <div style="width:56px;height:56px;background:${accent};border-radius:12px;transform:rotate(45deg);margin:4px 6px 0 0"></div>
            </td>
          </tr></table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:34px"><tr>
            <td class="shape" style="vertical-align:bottom"><div style="width:120px;height:4px;background:${accent}"></div></td>
            <td align="right" style="vertical-align:bottom;font-size:17px;font-weight:300;letter-spacing:0.2px;color:${onBrand}">${escapeHtml(eyebrow || title)}</td>
          </tr></table>
        </td></tr>

        <!-- The message -->
        <tr><td class="content" style="background:${page};padding:44px 40px 8px">
          <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:${ink}">${escapeHtml(title)}</h1>
          ${body}
          ${action ? button(action, palette) : ''}
          ${footnote ? `<p class="muted" style="margin:22px 0 0;font-size:13px;line-height:1.55;color:${soft}">${escapeHtml(footnote)}</p>` : ''}
        </td></tr>

        ${
          signOff
            ? `<!-- Signed off like a letter -->
        <tr><td class="closing" style="background:${page};padding:30px 40px 8px">
          <p style="margin:0 0 10px;font-size:16px;color:${ink}">Kind regards,</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:${ink}">The ${escapeHtml(brand)} team</p>
        </td></tr>`
            : ''
        }

        <!-- Footer: the logo and name, then how to reach the lender -->
        <tr><td class="footer" align="center" style="background:${page};padding:36px 40px 44px">
          <table role="presentation" width="75%" cellpadding="0" cellspacing="0"><tr><td class="rule" style="border-top:1px solid ${line};font-size:0;line-height:0">&nbsp;</td></tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 26px"><tr>
            ${logo ? `<td style="padding-right:12px;vertical-align:middle">${logoImage(40, 6)}</td>` : ''}
            <td style="vertical-align:middle;font-size:26px;font-weight:800;letter-spacing:-0.6px;color:${ink}">${escapeHtml(brand)}</td>
          </tr></table>
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${ink}">${escapeHtml(brand)}</p>
          ${branding.address ? `<p style="margin:0 0 4px;font-size:13px;color:${ink}">${escapeHtml(branding.address)}</p>` : ''}
          ${contacts.map((contact) => `<p style="margin:0 0 4px;font-size:13px;color:${ink}">${escapeHtml(contact)}</p>`).join('')}
          ${
            branding.email || website
              ? `<p style="margin:18px 0 0;font-size:13px;color:${ink}">${[
                  branding.email && `<a href="mailto:${escapeHtml(branding.email)}" style="color:${ink};text-decoration:underline">Contact us</a>`,
                  website && `<a href="${escapeHtml(website)}" style="color:${ink};text-decoration:underline">Visit our website</a>`,
                ]
                  .filter(Boolean)
                  .join(' &nbsp;|&nbsp; ')}</p>`
              : ''
          }
          <p class="muted" style="margin:16px 0 0;font-size:12px;color:${soft}">This is an automated message about your account. Replies to it may not be read.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const attachments = logo ? [{ filename: logo.contentType === 'image/jpeg' ? 'logo.jpg' : 'logo.png', content: logo.bytes, contentType: logo.contentType, cid: LOGO_CID }] : []
  return { html, attachments }
}
