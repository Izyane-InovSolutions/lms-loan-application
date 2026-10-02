import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'

export const zraTokenStore = {
  async get(key) {
    const db = await getDb()
    const [row] = await db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1)
    return typeof row?.value?.encrypted === 'string' ? row.value.encrypted : null
  },

  async set(key, encrypted) {
    const db = await getDb()
    const updatedAt = new Date()
    await db
      .insert(schema.settings)
      .values({ key, value: { encrypted }, updatedAt })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: { encrypted }, updatedAt },
      })
    return 'OK'
  },

  async del(key) {
    const db = await getDb()
    await db.delete(schema.settings).where(eq(schema.settings.key, key))
  },
}