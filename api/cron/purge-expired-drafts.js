import { runDailyMaintenance } from '../_lib/maintenance.js'
import { appOrigin } from '../_lib/http.js'

// Vercel's daily cron (vercel.json). The work itself is in api/_lib/maintenance.js, which
// admins can also start from System health.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
  }
  return res.status(200).json(await runDailyMaintenance(appOrigin(req)))
}
