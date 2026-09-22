import { describe, expect, it, vi } from 'vitest'
import {
  Maritime,
  MaritimeAuthError,
  MaritimeConflictError,
  MaritimeError,
  MaritimeNotFoundError,
  MaritimePaymentRequiredError,
} from '../src/index.js'

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** Build a fetch double that returns queued responses and records requests. */
function mockFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Recorded[] = []
  let i = 0
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
      headers[k.toLowerCase()] = v
    }
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    // 204/205/304 are null-body statuses — the Response constructor rejects a
    // body (even '') for them, mirroring real servers.
    const nullBody = r.status === 204 || r.status === 205 || r.status === 304
    const payload = nullBody || r.body === undefined ? null : JSON.stringify(r.body)
    return new Response(payload, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch, opts = {}) {
  return new Maritime({ apiKey: 'mk_test', baseUrl: 'https://api.example.test', fetch: fetchImpl, ...opts })
}

describe('client construction', () => {
  it('throws a MaritimeError when no api key is provided', () => {
    const prev = process.env.MARITIME_API_KEY
    delete process.env.MARITIME_API_KEY
    try {
      expect(() => new Maritime({ fetch: (() => {}) as unknown as typeof fetch })).toThrow(MaritimeError)
    } finally {
      if (prev) process.env.MARITIME_API_KEY = prev
    }
  })

  it('reads the api key from MARITIME_API_KEY', () => {
    process.env.MARITIME_API_KEY = 'mk_from_env'
    try {
      const { fetchImpl } = mockFetch([{ status: 200, body: [] }])
      const m = new Maritime({ baseUrl: 'https://x.test', fetch: fetchImpl })
      expect(m).toBeInstanceOf(Maritime)
    } finally {
      delete process.env.MARITIME_API_KEY
    }
  })
})

describe('requests', () => {
  it('sends the bearer token and parses JSON', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: [{ id: 'a1' }] }])
    const m = client(fetchImpl)
    const agents = await m.agents.list()
    expect(agents).toEqual([{ id: 'a1' }])
    expect(calls[0]!.headers['authorization']).toBe('Bearer mk_test')
    expect(calls[0]!.url).toBe('https://api.example.test/api/agents')
  })

  it('encodes create body as camelCase with templateId + initialEnvVars', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 201, body: { id: 'a1', name: 'x' } }])
    const m = client(fetchImpl)
    await m.agents.create({
      name: 'x',
      template: 'openclaw',
      externalId: 'cust_1',
      env: [{ key: 'FOO', value: 'bar' }],
    })
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.templateId).toBe('openclaw')
    expect(body.externalId).toBe('cust_1')
    expect(body.initialEnvVars).toEqual([{ key: 'FOO', value: 'bar', isSecret: true }])
  })

  it('chat sends conversation_id (snake_case, matching the API)', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { response: 'hi' } }])
    const m = client(fetchImpl)
    const r = await m.agents.chat('a1', 'hello', { conversationId: 'c1' })
    expect(r.response).toBe('hi')
    expect(calls[0]!.body).toEqual({ message: 'hello', conversation_id: 'c1' })
  })

  it('passes externalId as a query param on list', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: [] }])
    const m = client(fetchImpl)
    await m.agents.list({ externalId: 'cust_9' })
    expect(calls[0]!.url).toContain('externalId=cust_9')
  })

  it('returns undefined for 204 responses (delete)', async () => {
    const { fetchImpl } = mockFetch([{ status: 204 }])
    const m = client(fetchImpl)
    await expect(m.agents.delete('a1')).resolves.toBeUndefined()
  })
})

describe('typed errors', () => {
  const cases: Array<[number, unknown]> = [
    [401, MaritimeAuthError],
    [403, MaritimeAuthError],
    [402, MaritimePaymentRequiredError],
    [404, MaritimeNotFoundError],
    [409, MaritimeConflictError],
  ]
  for (const [status, klass] of cases) {
    it(`maps ${status} to the right error class`, async () => {
      const { fetchImpl } = mockFetch([{ status, body: { detail: 'boom' } }])
      const m = client(fetchImpl)
      await expect(m.agents.get('a1')).rejects.toBeInstanceOf(klass as never)
    })
  }

  it('exposes status + detail on the error', async () => {
    const { fetchImpl } = mockFetch([{ status: 404, body: { detail: 'no such agent' } }])
    const m = client(fetchImpl)
    await expect(m.agents.get('a1')).rejects.toMatchObject({ status: 404, detail: 'no such agent' })
  })
})

describe('retry', () => {
  it('retries a 503 then succeeds', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 503, body: { detail: 'unavailable' } },
      { status: 200, body: [{ id: 'ok' }] },
    ])
    const m = client(fetchImpl, { maxRetries: 2 })
    const r = await m.agents.list()
    expect(r).toEqual([{ id: 'ok' }])
    expect(calls.length).toBe(2)
  })

  it('does NOT retry a non-idempotent POST on 500', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 500, body: { detail: 'server error' } },
      { status: 201, body: { id: 'should-not-happen' } },
    ])
    const m = client(fetchImpl, { maxRetries: 3 })
    await expect(m.agents.create({ name: 'x', template: 'openclaw' })).rejects.toMatchObject({
      status: 500,
    })
    expect(calls.length).toBe(1)
  })

  it('honours an HTTP-date Retry-After header', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
    try {
      const { fetchImpl, calls } = mockFetch([
        {
          status: 503,
          body: { detail: 'unavailable' },
          headers: { 'retry-after': 'Tue, 22 Sep 2026 00:00:10 GMT' },
        },
        { status: 200, body: [{ id: 'ok' }] },
      ])
      const m = client(fetchImpl, { maxRetries: 1 })
      const request = m.agents.list()

      await vi.advanceTimersByTimeAsync(9_999)
      expect(calls.length).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(request).resolves.toEqual([{ id: 'ok' }])
      expect(calls.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after maxRetries on persistent 503', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 503, body: { detail: 'down' } }])
    const m = client(fetchImpl, { maxRetries: 2 })
    await expect(m.agents.list()).rejects.toMatchObject({ status: 503 })
    expect(calls.length).toBe(3) // initial + 2 retries
  })
})

describe('keys', () => {
  it('normalizes the snake_case /api/v1/keys response to camelCase', async () => {
    // The keys endpoint serializes snake_case (unlike the rest of the API); the
    // SDK must present a consistent camelCase shape or `.rawKey` is undefined.
    const { fetchImpl } = mockFetch([{
      status: 201,
      body: {
        id: 'k1', name: 'worker', key_prefix: 'mk_abc', scopes: ['deploy'],
        is_active: true, last_used_at: null, expires_at: null,
        created_at: '2026-07-07T00:00:00Z', raw_key: 'mk_secret_value',
      },
    }])
    const m = client(fetchImpl)
    const key = await m.keys.create({ name: 'worker', scopes: ['deploy'] })
    expect(key.rawKey).toBe('mk_secret_value')
    expect(key.keyPrefix).toBe('mk_abc')
    expect(key.isActive).toBe(true)
    expect(key.scopes).toEqual(['deploy'])
    // The snake_case keys must NOT leak through.
    expect((key as unknown as Record<string, unknown>).raw_key).toBeUndefined()
  })

  it('normalizes list() too', async () => {
    const { fetchImpl } = mockFetch([{
      status: 200,
      body: [{ id: 'k1', name: 'a', key_prefix: 'mk_x', scopes: ['manage'], is_active: true, last_used_at: null, expires_at: null, created_at: '2026-07-07T00:00:00Z' }],
    }])
    const m = client(fetchImpl)
    const [k] = await m.keys.list()
    expect(k.keyPrefix).toBe('mk_x')
    expect(k.isActive).toBe(true)
  })
})

describe('webhooks', () => {
  it('create posts url + events and returns the secret', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 201, body: { id: 'wh1', url: 'https://x.test/h', events: ['agent.error'], secret: 'whsec_abc' } },
    ])
    const m = client(fetchImpl)
    const wh = await m.webhooks.create({ url: 'https://x.test/h', events: ['agent.error'] })
    expect(wh.secret).toBe('whsec_abc')
    expect(calls[0]!.url).toBe('https://api.example.test/api/v1/webhooks')
    expect(calls[0]!.body).toEqual({ url: 'https://x.test/h', events: ['agent.error'] })
  })

  it('list and delete hit the right paths', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: [] }, { status: 204 }])
    const m = client(fetchImpl)
    await m.webhooks.list()
    expect(calls[0]!.url).toBe('https://api.example.test/api/v1/webhooks')
    await m.webhooks.delete('wh1')
    expect(calls[1]!.method).toBe('DELETE')
    expect(calls[1]!.url).toBe('https://api.example.test/api/v1/webhooks/wh1')
  })

  it('test() posts to the /test path', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { delivered: true, statusCode: 200 } }])
    const m = client(fetchImpl)
    const r = await m.webhooks.test('wh1')
    expect(r.delivered).toBe(true)
    expect(calls[0]!.url).toBe('https://api.example.test/api/v1/webhooks/wh1/test')
  })
})

describe('provision (get-or-create by externalId)', () => {
  it('returns the existing agent without creating', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: [{ id: 'existing', externalId: 'c1' }] }])
    const m = client(fetchImpl)
    const a = await m.agents.provision({ externalId: 'c1', name: 'x' })
    expect(a.id).toBe('existing')
    expect(calls.length).toBe(1) // only the list, no create
    expect(calls[0]!.method).toBe('GET')
  })

  it('creates when none exists, defaulting the template', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: [] }, // list → empty
      { status: 201, body: { id: 'new', externalId: 'c2' } }, // create
    ])
    const m = client(fetchImpl)
    const a = await m.agents.provision({ externalId: 'c2', name: 'x' })
    expect(a.id).toBe('new')
    expect(calls.length).toBe(2)
    expect(calls[1]!.method).toBe('POST')
    expect((calls[1]!.body as Record<string, unknown>).templateId).toBe('openclaw')
  })

  it('recovers from a create race (409) by re-reading', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: [] }, // list → empty
      { status: 409, body: { detail: 'name taken' } }, // create loses race
      { status: 200, body: [{ id: 'raced', externalId: 'c3' }] }, // re-read finds it
    ])
    const m = client(fetchImpl)
    const a = await m.agents.provision({ externalId: 'c3', name: 'x' })
    expect(a.id).toBe('raced')
    expect(calls.length).toBe(3)
  })
})
