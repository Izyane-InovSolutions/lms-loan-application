import { getSetting } from './settings.js'
import { DEFAULT_BRAND_NAME } from '../../src/config/branding.js'

/** The brand as saved in Settings → Branding, with the shipped defaults filling any gap. */
export const getBranding = async () => {
  const { name, logo } = await getSetting('branding')
  return { name: String(name || '').trim() || DEFAULT_BRAND_NAME, logo: logo?.pathname ? logo : null }
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
