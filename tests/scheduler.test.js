import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryKv } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
const runDailyMaintenance = vi.fn(async () => ({ scanned: 0 }))
vi.mock('../api/_lib/maintenance.js', () => ({ runDailyMaintenance }))

const { startScheduler } = await import('../api/_lib/scheduler.js')

afterEach(() => {
  vi.useRealTimers()
  runDailyMaintenance.mockClear()
})

describe('in-process daily maintenance', () => {
  it('runs once a day across replicas, and not before the hour', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers({ now: new Date(2026, 9, 1, 1, 30) })
    // Two replicas sharing one Redis.
    const stops = [startScheduler({ origin: 'https://loans.example.com', hour: 3 }), startScheduler({ origin: 'https://loans.example.com', hour: 3 })]

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(runDailyMaintenance).not.toHaveBeenCalled()

    // 03:00 comes round at the next checks.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(runDailyMaintenance).toHaveBeenCalledTimes(1)
    expect(runDailyMaintenance).toHaveBeenCalledWith('https://loans.example.com')

    // The rest of the day, nothing more; the next day, once more.
    await vi.advanceTimersByTimeAsync(20 * 60 * 60 * 1000)
    expect(runDailyMaintenance).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(runDailyMaintenance).toHaveBeenCalledTimes(2)
    stops.forEach((stop) => stop())
  })
})
