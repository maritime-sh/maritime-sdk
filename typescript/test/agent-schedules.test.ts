import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { observeScheduler, pushSchedules } from '../src/agent-schedules.js'

const ENV = {
  MARITIME_BACKEND_URL: 'https://api.test.maritime.sh',
  MARITIME_AGENT_ID: 'agent-123',
  MARITIME_INTERNAL_TOKEN: 'tok-abc',
}

describe('pushSchedules', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  })
  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k]
  })

  it('POSTs the schedule list with internal auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const ok = await pushSchedules(
      [{ id: 'a', nextRunAt: '2026-08-01T09:00:00Z' }],
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test.maritime.sh/api/agents/internal/schedules')
    expect(init.headers['X-Maritime-Agent-Id']).toBe('agent-123')
    expect(init.headers.Authorization).toBe('Bearer tok-abc')
    expect(JSON.parse(init.body).schedules).toHaveLength(1)
  })

  it('is a silent no-op off-Maritime (env missing)', async () => {
    delete process.env.MARITIME_INTERNAL_TOKEN
    const fetchMock = vi.fn()
    const ok = await pushSchedules([], { fetch: fetchMock as unknown as typeof fetch })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws on transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    const ok = await pushSchedules([], { fetch: fetchMock as unknown as typeof fetch })
    expect(ok).toBe(false)
  })
})

describe('observeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const k of Object.keys(ENV)) delete process.env[k]
  })

  it('debounces a burst of mutations into one push', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const scheduler = {
      jobs: [] as string[],
      add(j: string) { this.jobs.push(j) },
      list() { return this.jobs.map((id) => ({ id })) },
    }
    observeScheduler(scheduler, {
      fetch: fetchMock as unknown as typeof fetch,
      debounceMs: 100,
    })
    scheduler.add('a')
    scheduler.add('b')
    scheduler.add('c')
    await vi.advanceTimersByTimeAsync(150)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.schedules.map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns a manual push()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const scheduler = { getSchedules: () => [{ id: 'x', cron: '0 9 * * *' }] }
    const { push } = observeScheduler(scheduler, {
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(await push()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
