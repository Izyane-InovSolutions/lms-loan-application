import kv from './kv.js'

/*
 * Coarse per-applicant daily cap on model calls, so an endpoint reachable with any valid
 * draft token cannot be looped into an unbounded provider bill.
 *
 * Read-then-write rather than INCR: the dev stand-in in memoryKv.js has no INCR, and the
 * race only lets a burst of parallel requests overshoot the cap by a few, which is
 * irrelevant for a cost guard. A real applicant uses roughly one call per document plus
 * a couple of prescreens, so the default leaves plenty of room for replacing files.
 */
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_APPLICANT) || 60
const WINDOW_SECONDS = 24 * 60 * 60

export const consumeAiQuota = async (email) => {
  const key = `aiQuota:${email}`
  const used = Number(await kv.get(key)) || 0
  if (used >= DAILY_LIMIT) return false
  await kv.set(key, used + 1, used === 0 ? { ex: WINDOW_SECONDS } : { keepTtl: true })
  return true
}
