import { describe, expect, it, vi } from 'vitest'
import {
  Maritime,
  MaritimeConflictError,
  MaritimeNotFoundError,
  MaritimePaymentRequiredError,
  MaritimeRateLimitError,
} from '../src/index.js'
import type { ComputerAction } from '../src/index.js'

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  rawBody: unknown
}

// The client.test.ts mockFetch, extended like files.test.ts: keeps non-JSON
// request bodies (raw file writes) and can serve raw bytes with a content
// type and extra headers (screenshot and file reads).
function mockFetch(
  responses: Array<{
    status: number
    body?: unknown
    raw?: string
    headers?: Record<string, string>
  }>,
) {
  const calls: Recorded[] = []
  let i = 0
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
      headers[k.toLowerCase()] = v
    }
    let body: unknown = init?.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        /* keep raw */
      }
    }
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers, body, rawBody: init?.body })
    const r = responses[Math.min(i, responses.length - 1)]!
    i++
    const nullBody = r.status === 204 || r.status === 205 || r.status === 304
    const payload = nullBody
      ? null
      : r.raw !== undefined
        ? r.raw
        : r.body === undefined
          ? null
          : JSON.stringify(r.body)
    return new Response(payload, {
      status: r.status,
      headers: {
        'content-type': r.raw !== undefined ? 'application/octet-stream' : 'application/json',
        ...(r.headers ?? {}),
      },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch, opts = {}) {
  return new Maritime({
    apiKey: 'mk_test',
    baseUrl: 'https://api.example.test',
    fetch: fetchImpl,
    maxRetries: 0,
    ...opts,
  })
}

const BASE = 'https://api.example.test/api/v1/computers'

const COMPUTER = {
  id: 'cmp_1',
  externalUserId: 'user_42',
  name: null,
  status: 'ready',
  screen: { width: 1280, height: 800, modelWidth: 1200 },
  mode: 'agent',
  modeReason: null,
  takeoverSeq: null,
  takeoverExpiresAt: null,
  lastActionAt: null,
  lastWakeMs: 1200,
  lastWakeMethod: 'golden',
  createdAt: '2026-09-03T00:00:00Z',
}

describe('computers.create / list / get / delete', () => {
  it('create posts externalUserId and name to /api/v1/computers (201)', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 201, body: COMPUTER }])
    const c = await client(fetchImpl).computers.create({ externalUserId: 'user_42', name: 'desk' })
    expect(c.id).toBe('cmp_1')
    expect(c.screen.modelWidth).toBe(1200)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(BASE)
    expect(calls[0]!.body).toEqual({ externalUserId: 'user_42', name: 'desk' })
    expect(calls[0]!.headers['authorization']).toBe('Bearer mk_test')
  })

  it('create with no params sends an empty object (anonymous computer) and accepts 200', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: COMPUTER }])
    const c = await client(fetchImpl).computers.create()
    expect(c.status).toBe('ready')
    expect(calls[0]!.body).toEqual({})
  })

  it('list passes externalUserId as a query param and unwraps {computers}', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { computers: [COMPUTER] } }])
    const rows = await client(fetchImpl).computers.list({ externalUserId: 'user_42' })
    expect(rows).toEqual([COMPUTER])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}?externalUserId=user_42`)
  })

  it('list without params hits the bare collection', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { computers: [] } }])
    const rows = await client(fetchImpl).computers.list()
    expect(rows).toEqual([])
    expect(calls[0]!.url).toBe(BASE)
  })

  it('get encodes the id and returns the computer', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: COMPUTER }])
    const c = await client(fetchImpl).computers.get('cmp/1')
    expect(c.id).toBe('cmp_1')
    expect(calls[0]!.url).toBe(`${BASE}/cmp%2F1`)
  })

  it('get of a missing computer raises MaritimeNotFoundError with the API message', async () => {
    const { fetchImpl } = mockFetch([
      { status: 404, body: { error: 'not_found', message: 'No such computer.', retryAfterS: null } },
    ])
    await expect(client(fetchImpl).computers.get('nope')).rejects.toMatchObject({
      status: 404,
      detail: 'No such computer.',
    })
    await expect(client(fetchImpl).computers.get('nope')).rejects.toBeInstanceOf(MaritimeNotFoundError)
  })

  it('delete resolves undefined on 204', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 204 }])
    await expect(client(fetchImpl).computers.delete('cmp_1')).resolves.toBeUndefined()
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1`)
  })
})

describe('computers.wake / sleep', () => {
  it('wake POSTs and returns {status, wakeMs, method}', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { status: 'ready', wakeMs: 900, method: 'restore' } },
    ])
    const r = await client(fetchImpl).computers.wake('cmp_1')
    expect(r).toEqual({ status: 'ready', wakeMs: 900, method: 'restore' })
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/wake`)
    expect(calls[0]!.rawBody).toBeUndefined()
  })

  it('wake surfaces a 402 quota gate as MaritimePaymentRequiredError carrying the message verbatim', async () => {
    const message =
      'This Maritime account has used 100 of 100 included invocations this period and overage is disabled. A human must upgrade the plan at https://maritime.sh/billing/computers before this computer can be used again.'
    const { fetchImpl } = mockFetch([
      { status: 402, body: { error: 'quota_exceeded', message, retryAfterS: null } },
    ])
    const err = await client(fetchImpl).computers.wake('cmp_1').catch((e) => e)
    expect(err).toBeInstanceOf(MaritimePaymentRequiredError)
    expect(err.detail).toBe(message)
  })

  it('sleep POSTs and returns the computer', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { ...COMPUTER, status: 'sleeping' } }])
    const c = await client(fetchImpl).computers.sleep('cmp_1')
    expect(c.status).toBe('sleeping')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/sleep`)
  })
})

describe('computers.act', () => {
  const RESULT = {
    action: 'left_click',
    ok: true,
    frameId: 7,
    imageB64: 'iVBORw0KGgo=',
    width: 1200,
    height: 750,
    mime: 'image/png',
    coordinate: [10, 20],
  }

  it('single action: body is the camelCase action plus format/quality; result carries frameId/width/height', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: RESULT }])
    const action: ComputerAction = { action: 'left_click', coordinate: [10, 20], modifier: 'ctrl' }
    const r = await client(fetchImpl).computers.act('cmp_1', action, { format: 'jpeg', quality: 60 })
    expect(r.frameId).toBe(7)
    expect(r.width).toBe(1200)
    expect(r.height).toBe(750)
    expect(r.imageB64).toBe('iVBORw0KGgo=')
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/actions`)
    expect(calls[0]!.body).toEqual({
      action: 'left_click',
      coordinate: [10, 20],
      modifier: 'ctrl',
      format: 'jpeg',
      quality: 60,
    })
  })

  it('single action without options sends only the action fields', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: RESULT }])
    await client(fetchImpl).computers.act('cmp_1', { action: 'screenshot' })
    expect(calls[0]!.body).toEqual({ action: 'screenshot' })
  })

  it('batch: body is {actions, format?, quality?} and the results array is unwrapped', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { results: [{ ...RESULT, action: 'mouse_move' }, RESULT] } },
    ])
    const actions: ComputerAction[] = [
      { action: 'mouse_move', coordinate: [1, 2], noScreenshot: true },
      { action: 'left_click', coordinate: [1, 2] },
    ]
    const rs = await client(fetchImpl).computers.act('cmp_1', actions, { format: 'jpeg' })
    expect(rs).toHaveLength(2)
    expect(rs[1]!.frameId).toBe(7)
    expect(calls[0]!.body).toEqual({ actions, format: 'jpeg' })
  })

  it('409 human_in_control becomes MaritimeConflictError with the model-facing message', async () => {
    const { fetchImpl } = mockFetch([
      {
        status: 409,
        body: {
          error: 'human_in_control',
          message: 'A person has taken control of this computer. Wait, then take a screenshot to continue.',
          retryAfterS: 15,
        },
        headers: { 'retry-after': '15' },
      },
    ])
    const err = await client(fetchImpl).computers.act('cmp_1', { action: 'screenshot' }).catch((e) => e)
    expect(err).toBeInstanceOf(MaritimeConflictError)
    expect(err.detail).toBe(
      'A person has taken control of this computer. Wait, then take a screenshot to continue.',
    )
  })

  it('429 concurrency becomes MaritimeRateLimitError (no retries when maxRetries is 0)', async () => {
    const { fetchImpl, calls } = mockFetch([
      {
        status: 429,
        body: { error: 'concurrency', message: 'Too many open sessions. Retry in 15 seconds.', retryAfterS: 15 },
        headers: { 'retry-after': '15' },
      },
    ])
    const err = await client(fetchImpl).computers.act('cmp_1', { action: 'screenshot' }).catch((e) => e)
    expect(err).toBeInstanceOf(MaritimeRateLimitError)
    expect(err.detail).toBe('Too many open sessions. Retry in 15 seconds.')
    expect(calls.length).toBe(1)
  })
})

describe('computers.screenshot', () => {
  it('returns raw bytes and passes format/quality as query params', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, raw: 'PNGBYTES', headers: { 'x-frame-id': '3', 'x-screen-width': '1200', 'x-screen-height': '750' } },
    ])
    const bytes = await client(fetchImpl).computers.screenshot('cmp_1', { format: 'jpeg', quality: 70 })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('PNGBYTES')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/screenshot?format=jpeg&quality=70`)
  })

  it('defaults to no query when no options are given', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, raw: 'PNG' }])
    await client(fetchImpl).computers.screenshot('cmp_1')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/screenshot`)
  })
})

describe('computers.exec', () => {
  it('POSTs {command, timeoutS} and returns exitCode/stdout/stderr', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { exitCode: 0, stdout: 'hi\n', stderr: '' } },
    ])
    const r = await client(fetchImpl).computers.exec('cmp_1', 'echo hi', 10)
    expect(r).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' })
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/exec`)
    expect(calls[0]!.body).toEqual({ command: 'echo hi', timeoutS: 10 })
  })

  it('omits timeoutS when not given so the API default applies', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { exitCode: 1, stdout: '', stderr: 'x' } }])
    await client(fetchImpl).computers.exec('cmp_1', 'false')
    expect(calls[0]!.body).toEqual({ command: 'false' })
  })
})

describe('computers.files', () => {
  it('read GETs /files?path= and returns raw bytes', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, raw: 'hello' }])
    const bytes = await client(fetchImpl).computers.files.read('cmp_1', '/data/a.txt')
    expect(new TextDecoder().decode(bytes)).toBe('hello')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/files?path=%2Fdata%2Fa.txt`)
  })

  it('write PUTs the raw body as application/octet-stream (string is UTF-8 encoded)', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 204 }])
    await expect(client(fetchImpl).computers.files.write('cmp_1', '/data/a.txt', 'héllo')).resolves.toBeUndefined()
    const call = calls[0]!
    expect(call.method).toBe('PUT')
    expect(call.url).toBe(`${BASE}/cmp_1/files?path=%2Fdata%2Fa.txt`)
    expect(call.headers['content-type']).toBe('application/octet-stream')
    expect(call.rawBody).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(call.rawBody as Uint8Array)).toBe('héllo')
  })

  it('write accepts bytes untouched', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 204 }])
    const data = new Uint8Array([0, 255, 1])
    await client(fetchImpl).computers.files.write('cmp_1', '/data/b.bin', data)
    expect(Array.from(calls[0]!.rawBody as Uint8Array)).toEqual([0, 255, 1])
  })

  it('list GETs /files/list?path= and returns {path, entries}', async () => {
    const listing = { path: '/data', entries: [{ name: 'a.txt', size: 5, isDir: false, mtime: 1723900000 }] }
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: listing }])
    const r = await client(fetchImpl).computers.files.list('cmp_1', '/data')
    expect(r).toEqual(listing)
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/files/list?path=%2Fdata`)
  })
})

describe('computers.viewer / sessions / usage', () => {
  it('viewer POSTs {mode, ttlS, reason} and returns the link', async () => {
    const link = { url: 'https://maritime.sh/computer/cmp_1?t=abc', expiresAt: '2026-09-03T01:00:00Z', mode: 'control' }
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: link }])
    const r = await client(fetchImpl).computers.viewer('cmp_1', { mode: 'control', ttlS: 900, reason: 'login' })
    expect(r).toEqual(link)
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/viewer`)
    expect(calls[0]!.body).toEqual({ mode: 'control', ttlS: 900, reason: 'login' })
  })

  it('viewer defaults to watch mode when called without params', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { url: 'u', expiresAt: 'e', mode: 'watch' } },
    ])
    await client(fetchImpl).computers.viewer('cmp_1')
    expect(calls[0]!.body).toEqual({ mode: 'watch' })
  })

  it('closeSession returns the closed session on 200', async () => {
    const session = {
      id: 's1', computerId: 'cmp_1', startedAt: 't0', lastActionAt: 't1', endedAt: 't2',
      wallSeconds: 12, actions: 3, screenshots: 2, bytesOut: 100, invocationsCharged: 1,
      endReason: 'closed', client: null, modelHint: null, graceUntil: 't3',
    }
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: session }])
    const r = await client(fetchImpl).computers.closeSession('cmp_1')
    expect(r).toEqual(session)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/sessions/close`)
  })

  it('closeSession resolves undefined on 204 (no open session)', async () => {
    const { fetchImpl } = mockFetch([{ status: 204 }])
    await expect(client(fetchImpl).computers.closeSession('cmp_1')).resolves.toBeUndefined()
  })

  it('sessions unwraps {sessions}', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { sessions: [{ id: 's1' }] } }])
    const rs = await client(fetchImpl).computers.sessions('cmp_1')
    expect(rs).toEqual([{ id: 's1' }])
    expect(calls[0]!.url).toBe(`${BASE}/cmp_1/sessions`)
  })

  it('usage GETs /computers/usage with from/to/externalUserId', async () => {
    const report = { from: 'a', to: 'b', invocations: 2, wallSeconds: 10, actions: 4, screenshots: 3, computers: [] }
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: report }])
    const r = await client(fetchImpl).computers.usage({ from: '2026-09-01', to: '2026-09-02', externalUserId: 'u' })
    expect(r).toEqual(report)
    expect(calls[0]!.url).toBe(`${BASE}/usage?from=2026-09-01&to=2026-09-02&externalUserId=u`)
  })

  it('usage with no params hits the bare path', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { computers: [] } }])
    await client(fetchImpl).computers.usage()
    expect(calls[0]!.url).toBe(`${BASE}/usage`)
  })
})

describe('error bodies outside the computers prefix still work', () => {
  it('a {detail} error is still read as detail (no regression for the agents surface)', async () => {
    const { fetchImpl } = mockFetch([{ status: 404, body: { detail: 'Agent not found' } }])
    await expect(client(fetchImpl).agents.get('a1')).rejects.toMatchObject({ detail: 'Agent not found' })
  })
})
