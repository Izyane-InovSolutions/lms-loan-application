import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { text } from './http.js'
import { roleHas, rolesWith } from './roles.js'

const { users } = schema

/*
 * Who an application — or a draft of one — is credited to. Shared by submit and by draft
 * saves, so a draft started by an agent shows up in their pipeline under their name.
 */

/** The person a referral code belongs to: anyone active whose role brings business in. */
export const resolveReferral = async (code) => {
  const normalized = text(code, 20).toUpperCase()
  if (!normalized) return null
  const referring = await rolesWith('applications.assist')
  if (!referring.length) return null
  const db = await getDb()
  const [referrer] = await db
    .select()
    .from(users)
    .where(and(eq(users.referralCode, normalized), inArray(users.role, referring), eq(users.status, 'active')))
    .limit(1)
  return referrer || null
}

/**
 * channel / sourcedBy / assignedRm for business brought in by `person`, or self-service.
 * The channel is the person's role. A team lead (an RM, by default) is their own RM;
 * anyone else's is their manager.
 */
export const attributionFor = async (person, referralCode = null) => {
  if (!person) return { channel: 'self', sourcedBy: null, assignedRm: null, referralCode: null }
  return {
    channel: person.role,
    sourcedBy: person.id,
    assignedRm: (await roleHas(person.role, 'team.lead')) ? person.id : person.managerId || null,
    referralCode,
  }
}

/** An active user by id, for re-attributing from a stored draft. */
export const activeUser = async (id) => {
  if (!id) return null
  const db = await getDb()
  const [person] = await db.select().from(users).where(and(eq(users.id, id), eq(users.status, 'active'))).limit(1)
  return person || null
}
