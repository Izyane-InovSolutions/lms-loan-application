/**
 * The periods the Agents report offers, on the calendar in Lusaka (Africa/Lusaka, UTC+2
 * all year, no daylight saving): whole days from midnight to midnight, and calendar
 * months. Shared by the API, which counts within them, and the workspace, which names
 * them, so both agree to the minute — figures used for commission must.
 *
 *   'this-month'      the 1st of this month to the end of today
 *   'last-month'      the whole of last month
 *   'month:2026-08'   the whole of a past month
 *   '30' '60' '90'    the last 30, 60 or 90 calendar days, today included
 *   'all'             every date
 *
 * A range is { from, to } with `to` exclusive; both null for 'all'.
 */

export const TIMEZONE = 'Africa/Lusaka'
const OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const QUICK_PERIODS = [
  ['this-month', 'This month'],
  ['last-month', 'Last month'],
  ['30', '30 days'],
  ['60', '60 days'],
  ['90', '90 days'],
  ['all', 'All time'],
]

/** The periods the agent page lays side by side. */
export const COMPARED_PERIODS = ['this-month', 'last-month', '30', '60', '90', 'all']

export const DEFAULT_PERIOD = 'this-month'

const MONTH = /^month:(\d{4})-(0[1-9]|1[0-2])$/

/** Today's date in Lusaka as [year, monthIndex, day]. */
const lusakaToday = (now) => {
  const local = new Date(now.getTime() + OFFSET_MS)
  return [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()]
}

/** The instant a Lusaka calendar day starts; months and days overflow as Date.UTC allows. */
const lusakaMidnight = (year, month, day) => new Date(Date.UTC(year, month, day) - OFFSET_MS)

export const isPeriod = (key, now = new Date()) => {
  if (QUICK_PERIODS.some(([value]) => value === key)) return true
  const match = MONTH.exec(String(key || ''))
  if (!match) return false
  const [year, month] = lusakaToday(now)
  const asked = Number(match[1]) * 12 + Number(match[2]) - 1
  // A past or the current month; nothing before 2000, nothing in the future.
  return Number(match[1]) >= 2000 && asked <= year * 12 + month
}

/** Where a period starts and ends: { from, to } (to exclusive), or nulls for all time. */
export const periodRange = (key, now = new Date()) => {
  const [year, month, day] = lusakaToday(now)
  const tomorrow = lusakaMidnight(year, month, day + 1)
  if (key === 'all') return { from: null, to: null }
  if (key === 'this-month') return { from: lusakaMidnight(year, month, 1), to: tomorrow }
  if (key === 'last-month') return { from: lusakaMidnight(year, month - 1, 1), to: lusakaMidnight(year, month, 1) }
  const match = MONTH.exec(String(key))
  if (match) {
    const from = lusakaMidnight(Number(match[1]), Number(match[2]) - 1, 1)
    const end = lusakaMidnight(Number(match[1]), Number(match[2]), 1)
    return { from, to: end > tomorrow ? tomorrow : end }
  }
  const days = Number(key)
  return { from: lusakaMidnight(year, month, day - (days - 1)), to: tomorrow }
}

const dayLabel = (date, withYear) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: TIMEZONE })

/** "1 Sep – 30 Sep 2026", for under the period's name. Null for all time. */
export const periodDates = (key, now = new Date()) => {
  const { from, to } = periodRange(key, now)
  if (!from) return null
  const last = new Date(to.getTime() - DAY_MS)
  const sameYear = from.toLocaleDateString('en-GB', { year: 'numeric', timeZone: TIMEZONE }) === last.toLocaleDateString('en-GB', { year: 'numeric', timeZone: TIMEZONE })
  return `${dayLabel(from, !sameYear)} – ${dayLabel(last, true)}`
}

/** The period's name: "This month", "August 2026", "30 days". */
export const periodLabel = (key) => {
  const quick = QUICK_PERIODS.find(([value]) => value === key)
  if (quick) return quick[1]
  const match = MONTH.exec(String(key))
  if (!match) return key
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The last `count` months before this one, newest first, for the month picker. */
export const pastMonths = (count = 24, now = new Date()) => {
  const [year, month] = lusakaToday(now)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 15))
    const key = `month:${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    return [key, periodLabel(key)]
  })
}
