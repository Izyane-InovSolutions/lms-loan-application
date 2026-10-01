import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSerialRunner, uploadRetryDelay } from '../src/hooks/useApplicationDraft.js'
import {
  LOCAL_DRAFT_MAX_AGE_MS,
  clearLocalDraft,
  isLocalDraftExpired,
  loadLocalDraft,
  saveLocalDraft,
  staleFilePaths,
} from '../src/utils/localDraftStore.js'

const STORAGE_KEY = 'lms_application_draft_v1'

const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createSerialRunner', () => {
  it('runs one call at a time and folds overlapping requests into one trailing run', async () => {
    const gates = []
    let running = 0
    let maxRunning = 0
    let state = 'v1'
    const run = vi.fn(async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      const seen = state
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      running -= 1
      return seen
    })
    const save = createSerialRunner(run)

    const first = save()
    state = 'v2'
    const second = save()
    state = 'v3'
    const third = save()
    expect(second).toBe(third)
    expect(run).toHaveBeenCalledTimes(1)

    gates[0].resolve()
    await expect(first).resolves.toBe('v1')
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    gates[1].resolve()
    // The trailing run read the state as it was when it started, after every request.
    await expect(second).resolves.toBe('v3')
    expect(maxRunning).toBe(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('starts afresh once idle, and carries on after a failed run', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')
    const save = createSerialRunner(run)
    const failing = save()
    const trailing = save()
    await expect(failing).rejects.toThrow('boom')
    await expect(trailing).resolves.toBe('ok')
    await expect(save()).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe('uploadRetryDelay', () => {
  it('backs off exponentially up to a cap', () => {
    expect(uploadRetryDelay(1)).toBe(30000)
    expect(uploadRetryDelay(2)).toBe(60000)
    expect(uploadRetryDelay(3)).toBe(120000)
    expect(uploadRetryDelay(10)).toBe(300000)
  })
})

describe('local draft store', () => {
  let store
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats drafts older than the server TTL, or without a timestamp, as expired', () => {
    const now = Date.now()
    expect(isLocalDraftExpired({ savedAt: now - 1000 }, now)).toBe(false)
    expect(isLocalDraftExpired({ savedAt: now - LOCAL_DRAFT_MAX_AGE_MS - 1 }, now)).toBe(true)
    expect(isLocalDraftExpired({}, now)).toBe(true)
  })

  it('lists stored files the form no longer references', () => {
    expect(staleFilePaths(['personal.documents.tpin', 'personal.documents.nrcCopy'], ['personal.documents.nrcCopy'])).toEqual([
      'personal.documents.tpin',
    ])
    expect(staleFilePaths(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('deletes an expired draft instead of offering it', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ loanType: 'personal', currentStep: 2, savedAt: Date.now() - LOCAL_DRAFT_MAX_AGE_MS - 1 }))
    await expect(loadLocalDraft()).resolves.toBeNull()
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  it('returns a fresh draft', async () => {
    await saveLocalDraft({ loanType: 'personal', currentStep: 1, personalData: { a: 1 }, businessData: {}, loanData: {} })
    const draft = await loadLocalDraft()
    expect(draft).toMatchObject({ loanType: 'personal', currentStep: 1, personalData: { a: 1 } })
  })

  it('never lets a save that started before a clear land after it', async () => {
    const saving = saveLocalDraft({ loanType: 'personal', currentStep: 1, personalData: {}, businessData: {}, loanData: {} })
    const clearing = clearLocalDraft()
    await Promise.all([saving, clearing])
    expect(store.has(STORAGE_KEY)).toBe(false)
  })
})
