import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Maritime, verifyWebhookSignature } from '../src/index.js'

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

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
    const nullBody = r.status === 204 || r.status === 205 || r.status === 304
    const payload = nullBody || r.body === undefined ? null : JSON.stringify(r.body)
    return new Response(payload, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch) {
  return new Maritime({ apiKey: 'mk_test', baseUrl: 'https://api.example.test', fetch: fetchImpl })
}

const REPLIED = {
  messageId: 'msg_1',
  externalUserId: 'user_42',
  agentId: 'ag_1',
  status: 'replied',
  reply: 'hello back',
  error: null,
  userCreated: true,
  metadata: null,
  createdAt: '2026-07-12T00:00:00Z',
  repliedAt: '2026-07-12T00:00:02Z',
}

describe('projects.message', () => {
  it('POSTs the camelCase body to the front door and returns the state', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: REPLIED }])
    const msg = await client(fetchImpl).projects.message('proj_1', {
      externalUserId: 'user_42',
      message: 'hi',
      wait: 10,
      metadata: { threadId: 't1' },
    })
    expect(msg.status).toBe('replied')
    expect(msg.reply).toBe('hello back')
    expect(calls[0].url).toBe('https://api.example.test/api/v1/projects/proj_1/messages')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toMatchObject({
      externalUserId: 'user_42',
      message: 'hi',
      wait: 10,
      metadata: { threadId: 't1' },
    })
    expect(calls[0].headers['idempotency-key']).toBeUndefined()
  })

  it('sends Idempotency-Key when provided', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: REPLIED }])
    await client(fetchImpl).projects.message('proj_1', {
      externalUserId: 'user_42',
      message: 'hi',
      idempotencyKey: 'send-778',
    })
    expect(calls[0].headers['idempotency-key']).toBe('send-778')
  })

  it('returns the 202 provisioning state without throwing', async () => {
    const { fetchImpl } = mockFetch([
      { status: 202, body: { ...REPLIED, status: 'provisioning', reply: null, repliedAt: null } },
    ])
    const msg = await client(fetchImpl).projects.message('proj_1', {
      externalUserId: 'user_new',
      message: 'hi',
      wait: 0,
    })
    expect(msg.status).toBe('provisioning')
    expect(msg.reply).toBeNull()
  })
})

describe('projects resource paths', () => {
  it('getMessage / users / getUser / unbindUser / update hit the right endpoints', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: {} }, { status: 200, body: [] },
      { status: 200, body: {} }, { status: 204 }, { status: 200, body: {} }])
    const projects = client(fetchImpl).projects
    await projects.getMessage('p1', 'm1')
    await projects.users('p1')
    await projects.getUser('p1', 'user@a:b')
    await projects.unbindUser('p1', 'user@a:b')
    await projects.update('p1', { newChatPolicy: 'spawn', warmPoolSize: 3 })
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v1/projects/p1/messages/m1',
      'GET /api/v1/projects/p1/users',
      'GET /api/v1/projects/p1/users/user%40a%3Ab',
      'DELETE /api/v1/projects/p1/users/user%40a%3Ab',
      'PATCH /api/projects/p1',
    ])
    expect(calls[4].body).toMatchObject({ newChatPolicy: 'spawn', warmPoolSize: 3 })
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret'
  const body = JSON.stringify({ event: 'message.reply', message_id: 'm1' })
  const sign = (s: string, b: string) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex')

  it('accepts a valid signature', async () => {
    expect(await verifyWebhookSignature({ secret, body, signature: sign(secret, body) })).toBe(true)
  })

  it('rejects a tampered body', async () => {
    expect(
      await verifyWebhookSignature({ secret, body: body + 'x', signature: sign(secret, body) }),
    ).toBe(false)
  })

  it('rejects a wrong secret, missing header, and bad prefix', async () => {
    expect(
      await verifyWebhookSignature({ secret: 'whsec_other', body, signature: sign(secret, body) }),
    ).toBe(false)
    expect(await verifyWebhookSignature({ secret, body, signature: undefined })).toBe(false)
    expect(await verifyWebhookSignature({ secret, body, signature: 'md5=abc' })).toBe(false)
  })

  it('accepts Uint8Array bodies', async () => {
    const bytes = new TextEncoder().encode(body)
    expect(await verifyWebhookSignature({ secret, body: bytes, signature: sign(secret, body) })).toBe(true)
  })
})

describe('billing.usage', () => {
  it('GETs /api/v1/usage with query params', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { periodStart: 'x', periodEnd: 'y', agents: [] } },
    ])
    await client(fetchImpl).billing.usage({
      from: '2026-07-01',
      to: '2026-08-01',
      projectId: 'p1',
      externalUserId: 'cust_9',
    })
    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/api/v1/usage')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-07-01',
      to: '2026-08-01',
      projectId: 'p1',
      externalUserId: 'cust_9',
    })
  })
})
