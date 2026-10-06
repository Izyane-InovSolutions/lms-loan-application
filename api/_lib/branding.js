import { getSetting } from './settings.js'
import { readFile } from 'node:fs/promises'
import { readBlob } from './blob.js'
import { DEFAULT_BRAND_NAME } from '../../src/config/branding.js'

/** The brand as saved in Settings → Branding, with the shipped defaults filling any gap. */
export const getBranding = async () => {
  const { name, logo, address, phone, email, website, colour } = await getSetting('branding')
  return { name: String(name || '').trim() || DEFAULT_BRAND_NAME, logo: logo?.pathname ? logo : null, address, phone, email, website, colour }
}

// PDFs can carry PNG and JPG; a WebP logo (uploaded before uploads were converted to PNG)
// leaves the name on its own.
const PDF_IMAGE_TYPES = ['image/png', 'image/jpeg']
const BUNDLED_LOGO = new URL('../../src/assets/Icon.png', import.meta.url)

/**
 * The letterhead for generated documents (api/_lib/pdf.js): name, logo, address, contacts
 * and colour from Settings → Branding. `name` is the lender as documents name it.
 */
export const getLetterhead = async (name) => {
  const branding = await getBranding()
  let logo = null
  if (branding.logo && PDF_IMAGE_TYPES.includes(branding.logo.contentType)) {
    const stored = await readBlob(branding.logo).catch(() => null)
    if (stored) logo = { bytes: stored.data, contentType: branding.logo.contentType }
  } else if (!branding.logo) {
    // No upload: the bundled logo the site shows, so documents match it.
    const bytes = await readFile(BUNDLED_LOGO).catch(() => null)
    if (bytes) logo = { bytes, contentType: 'image/png' }
  }
  return {
    name: name || branding.name,
    logo,
    address: branding.address,
    contacts: [branding.phone, branding.email, branding.website].filter(Boolean).join('   ·   '),
    colour: branding.colour,
  }
}

/**
 * The brand name for emails, texts and documents. Never throws: a message is still worth
 * sending under the default name if the settings can't be read.
 */
export const brandName = async () => (await getBranding().catch(() => null))?.name || DEFAULT_BRAND_NAME

/** Where the browser loads a custom logo; the version changes with each upload, so it can be cached for good. */
export const logoUrl = (logo) => (logo ? `/api/v1/branding/logo?v=${encodeURIComponent(logo.version)}` : null)

/** What the public site needs: the name, and the custom logo's address (null means the bundled one). */
export const publicBranding = async () => {
  const { name, logo } = await getBranding()
  return { name, logoUrl: logoUrl(logo) }
}
