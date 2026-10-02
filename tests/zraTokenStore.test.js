import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

const { getDb, schema } = await import('../api/_lib/db/client.js')
const { zraTokenStore } = await import('../api/_lib/zra/tokenStore.js')
const testKey = `los:zra:tokens:test-${process.pid}`

afterAll(async () => {
  await zraTokenStore.del(testKey)
})

describe('ZRA database token store', () => {
  it('persists the encrypted token payload in the existing settings table', async () => {
    const encrypted = 'enc:v1:test-encrypted-token-payload'

    await zraTokenStore.set(testKey, encrypted)

    const db = await getDb()
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, testKey)).limit(1)
    expect(row.value).toEqual({ encrypted })
    expect(await zraTokenStore.get(testKey)).toBe(encrypted)
  })
})