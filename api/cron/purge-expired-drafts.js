import crypto from 'node:crypto'
import { runDailyMaintenance } from '../_lib/maintenance.js'
import { appOrigin } from '../_lib/http.js'
import { isDeployed } from '../_lib/runtime.js'

const authorised = (req) => {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`)
  const given = Buffer.from(String(req.headers.authorization || ''))
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// Vercel's daily cron (vercel.json). The work itself is in api/_lib/maintenance.js, which
// admins can also start from System health. A deployment without CRON_SECRET refuses
// rather than letting anyone run the deletions; only local development may skip it.
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    if (isDeployed()) return res.status(503).json({ message: 'Set CRON_SECRET to enable the scheduled maintenance.' })
  } else if (!authorised(req)) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  return res.status(200).json(await runDailyMaintenance(appOrigin(req)))
}
