import { Redis } from 'ioredis'

/*
 * The KV store over a plain Redis server (REDIS_URL, e.g. the `redis` service in
 * docker-compose.yml). Same get/set/del/incr/expire/exists surface as memoryKv.js and
 * the Upstash client, so the rest of the API does not know which one it has.
 *
 * Values are stored as JSON and parsed on the way out, as Upstash does: objects come back
 * as objects and counters from `incr` as numbers. Strings are JSON-encoded too, so a
 * stored "123" comes back as the string it was rather than the number.
 */

const decode = (raw) => {
  if (raw === null || raw === undefined) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Wraps an ioredis client. Exported for the tests, which pass a stand-in. */
export const createRedisKv = (client) => ({
  async get(key) {
    return decode(await client.get(key))
  },
  // Options as @vercel/kv takes them: { ex, px, nx, xx, keepTtl }. Answers "OK", or null
  // when nx/xx stopped the write.
  async set(key, value, options = {}) {
    const args = [key, JSON.stringify(value)]
    if (options.ex) args.push('EX', options.ex)
    else if (options.px) args.push('PX', options.px)
    else if (options.keepTtl) args.push('KEEPTTL')
    if (options.nx) args.push('NX')
    else if (options.xx) args.push('XX')
    return client.set(...args)
  },
  async del(...keys) {
    return client.del(...keys)
  },
  async incr(key) {
    return client.incr(key)
  },
  async expire(key, seconds) {
    return client.expire(key, seconds)
  },
  async exists(...keys) {
    return client.exists(...keys)
  },
})

export const connectRedis = (url) => {
  const client = new Redis(url, {
    // A request fails after a few reconnect attempts instead of hanging while Redis is down.
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  })
  let lastError = null
  client.on('error', (error) => {
    // Once per distinct failure: a reconnect loop would otherwise log every attempt.
    if (error.message === lastError) return
    lastError = error.message
    console.error(`[redis] ${error.message}`)
  })
  client.on('ready', () => {
    lastError = null
  })
  return createRedisKv(client)
}
