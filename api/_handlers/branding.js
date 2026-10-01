import { requireUser } from '../_lib/rbac.js'
import { fail } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { deleteBlobs, putBlob, readBlob } from '../_lib/blob.js'
import { readSingleUpload } from '../_lib/upload.js'
import { getSetting, setSetting } from '../_lib/settings.js'
import { getBranding, publicBranding } from '../_lib/branding.js'
import { LOGO_MAX_BYTES, LOGO_TYPES } from '../../src/config/branding.js'

/*
 * Settings → Branding. The name is saved like any other setting (PUT /settings/branding,
 * validated in settings.js); the logo is uploaded here, stored in the file store and
 * served back through this router, so it works with a private Blob store too.
 */

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Public: the name and logo address every page shows. */
const getPublic = async () => publicBranding()

/** Public: the custom logo itself. 404 when none is set, and the page uses the bundled one. */
const getLogo = async (req, res, { query }) => {
  const { logo } = await getBranding()
  if (!logo) fail(404, 'No custom logo is set.', 'not_found')
  const stored = await readBlob(logo)
  if (!stored) fail(404, 'The logo is no longer in storage.', 'not_found')
  res.setHeader('Content-Type', logo.contentType)
  res.setHeader('Content-Length', stored.data.length)
  // The address carries the upload's version, so a matching request can be cached for good.
  res.setHeader('Cache-Control', query.get('v') === logo.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
  res.setHeader('Content-Security-Policy', "default-src 'none'")
  res.statusCode = 200
  res.end(stored.data)
}

const uploadLogo = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const { file } = await readSingleUpload(req)
  if (!LOGO_TYPES.includes(file.contentType)) fail(400, 'Upload the logo as a PNG, JPG or WebP image.', 'unsupported_type')
  if (file.data.length > LOGO_MAX_BYTES) fail(413, 'That image is too large. Upload a logo of 1 MB or less.', 'file_too_large')

  const previous = (await getSetting('branding')).logo
  const version = Date.now().toString(36)
  const stored = await putBlob(`branding/logo-${version}.${EXTENSIONS[file.contentType]}`, file.data, { contentType: file.contentType })
  const logo = { pathname: stored.pathname, url: stored.url, contentType: file.contentType, size: file.data.length, filename: file.filename.slice(0, 200), version }
  await setSetting('branding', { logo }, actor)
  if (previous?.pathname) await deleteBlobs([previous]).catch((error) => console.warn(`[branding] old logo not removed: ${error?.message}`))
  await recordAudit({ req, actor, action: 'settings.logo_updated', entityType: 'setting', entityId: 'branding', detail: { filename: logo.filename, size: logo.size } })
  return { branding: await publicBranding() }
}

/** Back to the bundled logo. */
const removeLogo = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const previous = (await getSetting('branding')).logo
  if (previous) {
    await setSetting('branding', { logo: null }, actor)
    if (previous.pathname) await deleteBlobs([previous]).catch((error) => console.warn(`[branding] old logo not removed: ${error?.message}`))
    await recordAudit({ req, actor, action: 'settings.logo_removed', entityType: 'setting', entityId: 'branding' })
  }
  return { branding: await publicBranding() }
}

export const brandingRoutes = [
  ['GET', '/branding', getPublic],
  ['GET', '/branding/logo', getLogo],
  ['POST', '/admin/branding/logo', uploadLogo],
  ['DELETE', '/admin/branding/logo', removeLogo],
]
