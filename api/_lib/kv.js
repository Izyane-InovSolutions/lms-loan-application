import { createClient } from '@vercel/kv'
import { createMemoryKv } from './memoryKv.js'
import { connectRedis } from './redisKv.js'
import { isDeployed } from './runtime.js'

/*
 * Where drafts, one-time codes, locks and rate limits live, in order of preference:
 *
 *   REDIS_URL                       any Redis server (the `redis` service in
 *                                   docker-compose.yml): redis://:password@host:6379
 *   KV_REST_API_URL + _TOKEN        Upstash Redis over its REST API (@vercel/kv). A store
 *   (or UPSTASH_REDIS_REST_*)       made directly at Upstash names the pair UPSTASH_REDIS_REST_*.
 *   LOS_LOCAL_KV_FILE, or nothing   the JSON file in memoryKv.js. One process only: a
 *   locally                         second container or instance would not see its writes.
 *
 * A deployment with none of these fails loudly on first use instead of half-working: on
 * Vercel each invocation has its own read-only filesystem, and in containers each replica
 * has its own, so a draft written by one request would be invisible to the next and the
 * OTP step would keep reporting "No in-progress application found for this email". A
 * single-server deployment may still choose the file by setting LOS_LOCAL_KV_FILE.
 */
const redisUrl = (process.env.REDIS_URL || '').trim()
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const createUnconfiguredKv = () =>
  new Proxy(
    {},
    {
      get(target, property) {
        // Not a promise, and not inspectable: only a real store call should throw.
        if (property === 'then' || typeof property === 'symbol') return undefined
        throw new Error(
          'No Redis store is configured for this deployment. Set REDIS_URL (the redis service ' +
            'in docker-compose.yml, or any Redis server), or LOS_LOCAL_KV_FILE to keep them in a ' +
            'file on a single server.'
        )
      },
    }
  )

const kv = redisUrl
  ? connectRedis(redisUrl)
  : url && token
    ? createClient({ url, token })
    : isDeployed() && !process.env.LOS_LOCAL_KV_FILE
      ? createUnconfiguredKv()
      : createMemoryKv()

export default kv
