import kv from './kv.js'
import { runDailyMaintenance } from './maintenance.js'

/*
 * The daily maintenance run (maintenance.js) without an outside cron, for containers.
 * server.js starts it when LOS_SCHEDULER=true.
 *
 * Every instance checks every few minutes. Once the local time (TZ) is past
 * LOS_MAINTENANCE_HOUR, default 3, the first instance to take that day's lock in Redis
 * runs it, so it runs once a day however many replicas there are. A day missed while
 * everything was down runs at the next check. Admins can still start it from System health.
 */

const CHECK_EVERY_MS = 10 * 60 * 1000
// Longer than a day, so the lock outlives the date it is for in every timezone.
const LOCK_SECONDS = 36 * 60 * 60

const localDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

/** Starts the checks; returns a function that stops them. `origin` is the site's address, for links in emails. */
export const startScheduler = ({ origin, hour = Number(process.env.LOS_MAINTENANCE_HOUR ?? 3) }) => {
  const check = async () => {
    const now = new Date()
    if (now.getHours() < hour) return
    const lock = `los:cron:daily:${localDate(now)}`
    if ((await kv.set(lock, { startedAt: now.toISOString(), pid: process.pid }, { nx: true, ex: LOCK_SECONDS })) === null) return
    console.log('[scheduler] daily maintenance starting')
    const summary = await runDailyMaintenance(origin)
    console.log(`[scheduler] daily maintenance done: ${JSON.stringify(summary)}`)
  }
  const run = () => check().catch((error) => console.error(`[scheduler] daily maintenance failed: ${error?.message || error}`))

  // The first check waits a minute, so a container that is restarting in a loop does not run it.
  const first = setTimeout(run, 60 * 1000)
  const timer = setInterval(run, CHECK_EVERY_MS)
  first.unref()
  timer.unref()
  console.log(`[scheduler] daily maintenance after ${String(hour).padStart(2, '0')}:00 (${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
