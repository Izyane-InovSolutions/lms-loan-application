// In-process stand-in for @vercel/kv, used only when no KV store is configured
// (local `vite dev` testing without a linked Vercel project). Same get/set/del/
// expire/exists surface our API routes rely on, including TTL semantics.
const store = new Map()

const isExpired = (entry) => entry.expiresAt !== null && Date.now() > entry.expiresAt

export function createMemoryKv() {
  return {
    async get(key) {
      const entry = store.get(key)
      if (!entry || isExpired(entry)) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async set(key, value, options = {}) {
      const existing = store.get(key)
      let expiresAt = null
      if (options.keepTtl && existing && !isExpired(existing)) {
        expiresAt = existing.expiresAt
      } else if (options.ex) {
        expiresAt = Date.now() + options.ex * 1000
      }
      store.set(key, { value, expiresAt })
    },
    async del(key) {
      store.delete(key)
    },
    async expire(key, seconds) {
      const entry = store.get(key)
      if (entry) entry.expiresAt = Date.now() + seconds * 1000
    },
    async exists(key) {
      const entry = store.get(key)
      if (!entry || isExpired(entry)) {
        store.delete(key)
        return 0
      }
      return 1
    },
  }
}
