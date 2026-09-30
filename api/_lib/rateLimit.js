import crypto from 'node:crypto'
import kv from './kv.js'
import { clientIp } from './http.js'

/*
 * Fixed-window counters in the KV store. INCR is atomic, so parallel requests each see
 * their own count — a read-then-write counter lets a burst of guesses all read "0".
 */

/** A KV key for a counter; the value is hashed so emails and IPs are not stored in the clear. */
export const rateKey = (scope, value) => `los:${scope}:${crypto.createHash('sha256').update(String(value)).digest('hex')}`

/** Counts one attempt and returns the count so far in this window. */
export const countAttempt = async (key, windowSeconds) => {
  const count = await kv.incr(key)
  if (count === 1) await kv.expire(key, windowSeconds)
  return count
}

/** Counts an attempt; true while under the limit. */
export const underLimit = async (key, max, windowSeconds) => (await countAttempt(key, windowSeconds)) <= max

/** The caller's address for per-IP limits, or a fixed bucket when it cannot be told. */
export const ipOf = (req) => clientIp(req) || 'unknown'
