/**
 * Agent-side schedule observation (runs INSIDE a Maritime agent).
 *
 * A Maritime agent sleeps at ~zero cost between events; anything that
 * must happen on a timeline needs Maritime to wake the VM. Your agent
 * keeps its own scheduler; these helpers just push a read-only
 * projection of it so Maritime becomes the durable alarm clock.
 *
 * Two ways in (either is enough):
 *
 * 1. Serve `GET /schedules` on your agent's HTTP server returning
 *    `ScheduleView[]` -- Maritime polls it while you're awake. No SDK
 *    needed.
 * 2. Call {@link pushSchedules} (or wire {@link observeScheduler})
 *    whenever your schedule changes -- zero-latency sync, works even
 *    if you crash before Maritime's next poll.
 *
 * Credentials come from the env every Maritime agent already has
 * (`MARITIME_BACKEND_URL`, `MARITIME_AGENT_ID`,
 * `MARITIME_INTERNAL_TOKEN`); off-Maritime these are absent and every
 * helper becomes a silent no-op, so the calls are safe to leave in
 * during local development.
 */

/** One entry of your scheduler's read-only projection. */
export interface ScheduleView {
  /** Stable identifier within your scheduler. */
  id: string
  /**
   * The next occurrence, as YOUR scheduler computed it (ISO 8601).
   * Preferred over `cron`: Maritime never re-parses your expressions,
   * so the clocks cannot disagree. Push again after each run with the
   * new value.
   */
  nextRunAt?: string
  /** Alternative: a standard 5-field cron expression. */
  cron?: string
  /** IANA timezone for `cron` (default UTC). */
  tz?: string
  /**
   * Optional: text Maritime delivers to your `POST /chat` right after
   * waking you. Use when your scheduler doesn't self-fire on wake.
   */
  prompt?: string
  /** Optional display name. */
  name?: string
  /** Set false to pause without removing. */
  enabled?: boolean
}

export interface AgentScheduleOptions {
  /** Override MARITIME_BACKEND_URL. */
  backendUrl?: string
  /** Override MARITIME_AGENT_ID. */
  agentId?: string
  /** Override MARITIME_INTERNAL_TOKEN. */
  token?: string
  /** Custom fetch (tests, proxies). */
  fetch?: typeof fetch
}

function resolveEnv(opts: AgentScheduleOptions = {}) {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {}
  const backendUrl = opts.backendUrl ?? env.MARITIME_BACKEND_URL
  const agentId = opts.agentId ?? env.MARITIME_AGENT_ID
  const token = opts.token ?? env.MARITIME_INTERNAL_TOKEN
  if (!backendUrl || !agentId || !token) return null
  return { backendUrl: backendUrl.replace(/\/+$/, ''), agentId, token }
}

/**
 * Push the full current schedule list to Maritime. Send the COMPLETE
 * list every time: Maritime adds, updates, and removes wake triggers
 * to match it, so an empty array clears all synced wakes.
 *
 * Resolves to `true` when accepted, `false` when skipped (not running
 * on Maritime) or rejected. Never throws.
 */
export async function pushSchedules(
  schedules: ScheduleView[],
  opts: AgentScheduleOptions = {},
): Promise<boolean> {
  const creds = resolveEnv(opts)
  if (!creds) return false
  const f = opts.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  if (!f) return false
  try {
    const res = await f(`${creds.backendUrl}/api/agents/internal/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Maritime-Agent-Id': creds.agentId,
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({ schedules }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Methods wrapped by default when present on the scheduler object. */
const DEFAULT_MUTATORS = [
  'add', 'remove', 'update', 'cancel', 'delete',
  'schedule', 'unschedule', 'pause', 'resume',
]

export interface ObserveSchedulerOptions extends AgentScheduleOptions {
  /**
   * Produce the current `ScheduleView[]` from your scheduler. Defaults
   * to calling `scheduler.getSchedules()` or `scheduler.list()`.
   */
  getSnapshot?: (scheduler: unknown) => ScheduleView[] | Promise<ScheduleView[]>
  /** Which method names to instrument (default: common mutator names). */
  methods?: string[]
  /** Debounce between a mutation and the push, ms (default 500). */
  debounceMs?: number
}

/**
 * One-line Tier C wrap: instruments your scheduler's mutator methods so
 * every add/remove/update pushes the fresh snapshot to Maritime
 * moments later. Your scheduling logic is untouched (OTel-style).
 *
 * ```ts
 * import { observeScheduler } from 'maritime-sdk'
 * observeScheduler(myScheduler, {
 *   getSnapshot: (s) => s.jobs.map(j => ({ id: j.id, nextRunAt: j.next.toISOString() })),
 * })
 * ```
 *
 * Returns a `push()` you can also call manually (e.g. once at boot).
 */
export function observeScheduler(
  scheduler: unknown,
  opts: ObserveSchedulerOptions = {},
): { push: () => Promise<boolean> } {
  const debounceMs = opts.debounceMs ?? 500
  const getSnapshot = opts.getSnapshot ?? ((s: unknown) => {
    const anyS = s as { getSchedules?: () => ScheduleView[]; list?: () => ScheduleView[] }
    if (typeof anyS.getSchedules === 'function') return anyS.getSchedules()
    if (typeof anyS.list === 'function') return anyS.list()
    return []
  })

  const push = async (): Promise<boolean> => {
    try {
      const snapshot = await getSnapshot(scheduler)
      return await pushSchedules(Array.isArray(snapshot) ? snapshot : [], opts)
    } catch {
      return false
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedulePush = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void push() }, debounceMs)
    // Never keep the process alive just for a pending sync.
    ;(timer as { unref?: () => void }).unref?.()
  }

  const target = scheduler as Record<string, unknown>
  for (const name of opts.methods ?? DEFAULT_MUTATORS) {
    const original = target[name]
    if (typeof original !== 'function') continue
    target[name] = function (this: unknown, ...args: unknown[]) {
      const result = (original as (...a: unknown[]) => unknown).apply(this, args)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then((v) => { schedulePush(); return v })
      }
      schedulePush()
      return result
    }
  }

  return { push }
}
