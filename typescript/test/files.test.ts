import { describe, expect, it, vi } from 'vitest'
import { Maritime, MaritimeConflictError, MaritimeNotFoundError } from '../src/index.js'

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

// Like the shared mockFetch in the other suites, but keeps non-JSON bodies
// (FormData uploads) and can serve raw bytes (binary downloads).
function mockFetch(
  responses: Array<{ status: number; body?: unknown; raw?: string }>,
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
      try { body = JSON.parse(body) } catch { /* keep raw */ }
    }
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers, body })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    const payload = r.raw !== undefined ? r.raw : r.body === undefined ? null : JSON.stringify(r.body)
    return new Response(payload, {
      status: r.status,
      headers: { 'content-type': r.raw !== undefined ? 'application/octet-stream' : 'application/json' },
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch) {
  return new Maritime({ apiKey: 'mk_test', baseUrl: 'https://api.example.test', fetch: fetchImpl })
}

describe('agents.files.list', () => {
  it('omits path to let the backend pick the volume root', async () => {
    const listing = {
      path: '/zeroclaw-data',
      root: '/zeroclaw-data',
      entries: [{ name: 'workspace', isDir: true, size: 0, mtime: 1723900000 }],
    }
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: listing }])
    const res = await client(fetchImpl).agents.files.list('ag_1')
    expect(res.root).toBe('/zeroclaw-data')
    expect(res.entries[0].isDir).toBe(true)
    expect(calls[0].url).toBe('https://api.example.test/api/agents/ag_1/files/list')
  })

  it('passes an explicit path', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { path: '/data/sub', root: '/data', entries: [] } },
    ])
    await client(fetchImpl).agents.files.list('ag_1', '/data/sub')
    expect(calls[0].url).toBe('https://api.example.test/api/agents/ag_1/files/list?path=%2Fdata%2Fsub')
  })
})

describe('agents.files.download', () => {
  it('returns raw bytes', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, raw: 'PDFDATA' }])
    const bytes = await client(fetchImpl).agents.files.download('ag_1', '/tmp/report.pdf')
    expect(new TextDecoder().decode(bytes)).toBe('PDFDATA')
    expect(calls[0].url).toBe(
      'https://api.example.test/api/agents/ag_1/files/download?path=%2Ftmp%2Freport.pdf',
    )
  })
})

describe('agents.files.upload', () => {
  it('sends multipart with dest_dir and lets fetch set the boundary', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { ok: true, path: '/data/in/data.csv', name: 'data.csv', size: 8 } },
    ])
    const res = await client(fetchImpl).agents.files.upload('ag_1', {
      content: 'a,b\n1,2\n',
      filename: 'data.csv',
      destDir: '/data/in',
    })
    expect(res.path).toBe('/data/in/data.csv')
    const call = calls[0]
    expect(call.method).toBe('POST')
    expect(call.body).toBeInstanceOf(FormData)
    const form = call.body as FormData
    expect((form.get('file') as File).name).toBe('data.csv')
    expect(form.get('dest_dir')).toBe('/data/in')
    // Content-Type must NOT be forced to application/json for multipart.
    expect(call.headers['content-type']).toBeUndefined()
  })

  it('omits dest_dir for chat-attachment delivery and carries the message', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { ok: true, path: '/data/inbox/1-x.txt', name: 'x.txt', size: 1 } },
    ])
    await client(fetchImpl).agents.files.upload('ag_1', {
      content: new Uint8Array([120]),
      filename: 'x.txt',
      message: 'here you go',
    })
    const form = calls[0].body as FormData
    expect(form.get('dest_dir')).toBeNull()
    expect(form.get('message')).toBe('here you go')
  })
})

describe('agents.files write / mkdir / move / delete', () => {
  it('write PUTs path+content', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { ok: true, path: '/data/a.md' } }])
    await client(fetchImpl).agents.files.write('ag_1', '/data/a.md', '# hi')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://api.example.test/api/agents/ag_1/files/write')
    expect(calls[0].body).toEqual({ path: '/data/a.md', content: '# hi' })
  })

  it('mkdir POSTs the path', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { ok: true, path: '/data/new' } }])
    await client(fetchImpl).agents.files.mkdir('ag_1', '/data/new')
    expect(calls[0].body).toEqual({ path: '/data/new' })
  })

  it('move surfaces a 409 collision as MaritimeConflictError', async () => {
    const { fetchImpl } = mockFetch([{ status: 409, body: { detail: 'Destination already exists' } }])
    await expect(
      client(fetchImpl).agents.files.move('ag_1', '/data/a', '/data/b'),
    ).rejects.toBeInstanceOf(MaritimeConflictError)
  })

  it('delete of a missing path raises MaritimeNotFoundError', async () => {
    const { fetchImpl } = mockFetch([{ status: 404, body: { detail: 'File not found' } }])
    await expect(
      client(fetchImpl).agents.files.delete('ag_1', '/data/ghost'),
    ).rejects.toBeInstanceOf(MaritimeNotFoundError)
  })

  it('delete sends the path as a query param', async () => {
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: { ok: true, path: '/data/x' } }])
    await client(fetchImpl).agents.files.delete('ag_1', '/data/x')
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url).toBe(
      'https://api.example.test/api/agents/ag_1/files/delete?path=%2Fdata%2Fx',
    )
  })
})

describe('agents.exec', () => {
  it('POSTs a raw command string and returns the result', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { exitCode: 0, stdout: 'hello\n', stderr: '' } },
    ])
    const res = await client(fetchImpl).agents.exec('ag_1', 'echo hello')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('hello\n')
    expect(calls[0].url).toBe('https://api.example.test/api/agents/ag_1/exec')
    expect(calls[0].body).toEqual({ command: 'echo hello' })
  })

  it('passes argv arrays and the timeout through', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { exitCode: 1, stdout: '', stderr: '' } },
    ])
    await client(fetchImpl).agents.exec('ag_1', ['ls', '-la', '/data'], { timeout: 90 })
    expect(calls[0].body).toEqual({ command: ['ls', '-la', '/data'], timeout: 90 })
  })
})
