/*
 * The product's name and logo as shipped. Admins change both in Settings → Branding
 * (api/_handlers/branding.js); these apply until they do, and again if a change is undone.
 * The bundled logo itself is src/assets/Icon.png.
 */
export const DEFAULT_BRAND_NAME = 'Loan Origination'
export const BRAND_NAME_MAX = 60

// Raster images only: an SVG is a document that can carry script, and the logo is
// served from our own origin to every visitor.
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const LOGO_MAX_BYTES = 1024 * 1024
