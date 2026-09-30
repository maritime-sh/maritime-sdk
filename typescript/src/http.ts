import { apiErrorFromStatus, MaritimeConnectionError, MaritimeError } from './errors.js'

export interface MaritimeClientOptions {
  /**
   * Maritime API key (`mk_...`). Defaults to the `MARITIME_API_KEY` env var.
   * Mint one from the dashboard (Settings → API keys) or `maritime keys create`.
   */
  apiKey?: string
  /** API base URL. Defaults to `MARITIME_API_URL` or `https://api.maritime.sh`. */
  baseUrl?: string
  /** Per-request timeout in ms (default 60_000). */
  timeout?: number
  /** Retries on network errors and 5xx/429 responses (default 2). */
  maxRetries?: number
  /** Inject a custom fetch (tests, proxies, non-global-fetch runtimes). */
  fetch?: typeof fetch
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>
}

interface RequestOptions {
  method: string
  path: string
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  /** Multipart body (file uploads). Mutually exclusive with `body`; the
   * runtime's fetch sets the Content-Type boundary itself. */
  multipart?: FormData
  /** Raw bytes sent as `application/octet-stream` (file writes). Mutually
   * exclusive with `body` and `multipart`. */
  rawBody?: Uint8Array
  /** Extra headers for this one request (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>
  /** Override retry behaviour for a single call (e.g. non-idempotent POST). */
  idempotent?: boolean
  /** Return the raw response bytes (Uint8Array) instead of parsing JSON. */
  binary?: boolean
}

const DEFAULT_BASE_URL = 'https://api.maritime.sh'
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function resolveApiKey(explicit?: string): string {
  const key = explicit ?? (typeof process !== 'undefined' ? process.env?.MARITIME_API_KEY : undefined)
  if (!key) {
    throw new MaritimeError(
      'Missing Maritime API key. Pass { apiKey } to the client or set MARITIME_API_KEY.',
    )
  }
  return key
}

function resolveBaseUrl(explicit?: string): string {
  const url =
    explicit ??
    (typeof process !== 'undefined' ? process.env?.MARITIME_API_URL : undefined) ??
    DEFAULT_BASE_URL
  return url.replace(/\/+$/, '')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Thin transport: auth header, JSON encode/decode, typed errors, and bounded
 * retry with exponential backoff on transient failures. No dependencies —
 * uses the runtime's global `fetch` (Node 18+, Bun, Deno, browsers, edge).
 */
export class HttpClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch
  private readonly defaultHeaders: Record<string, string>

  constructor(options: MaritimeClientOptions = {}) {
    this.apiKey = resolveApiKey(options.apiKey)
    this.baseUrl = resolveBaseUrl(options.baseUrl)
    this.timeout = options.timeout ?? 60_000
    this.maxRetries = options.maxRetries ?? 2
    const f = options.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined)
    if (!f) {
      throw new MaritimeError(
        'No global fetch available. Use Node 18+, or pass a { fetch } implementation.',
      )
    }
    // Bind so `this` inside native fetch stays correct.
    this.fetchImpl = f.bind(globalThis) as typeof fetch
    this.defaultHeaders = options.defaultHeaders ?? {}
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + path)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'maritime-sdk',
      ...this.defaultHeaders,
      ...opts.headers,
    }
    const init: RequestInit = { method: opts.method, headers }
    if (opts.multipart !== undefined) {
      init.body = opts.multipart
    } else if (opts.rawBody !== undefined) {
      headers['Content-Type'] = 'application/octet-stream'
      init.body = opts.rawBody as Uint8Array<ArrayBuffer>
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    // GET/DELETE are idempotent and safe to retry; POST/PUT retry only on
    // network errors + 429/503 (never on a 5xx that may have applied a write),
    // unless the caller explicitly marks the call idempotent.
    const method = opts.method.toUpperCase()
    const retrySafe = opts.idempotent ?? (method === 'GET' || method === 'DELETE')

    let lastErr: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)

      let res: Response
      try {
        res = await this.fetchImpl(url, { ...init, signal: controller.signal })
      } catch (err) {
        // Transport-level failure (DNS, connection, timeout/abort). Retry.
        clearTimeout(timer)
        lastErr = err
        if (attempt < this.maxRetries) {
          await sleep(this.backoff(attempt))
          continue
        }
        const reason = err instanceof Error ? err.message : String(err)
        throw new MaritimeConnectionError(
          `Failed to reach Maritime at ${this.baseUrl}: ${reason}`,
          err,
        )
      }
      clearTimeout(timer)

      if (res.ok) {
        if (opts.binary) return new Uint8Array(await res.arrayBuffer()) as T
        return (await this.parseBody(res)) as T
      }

      const detail = await this.safeDetail(res)
      const requestId = res.headers.get('x-request-id') ?? undefined
      const retryable =
        attempt < this.maxRetries &&
        RETRYABLE_STATUS.has(res.status) &&
        (retrySafe || res.status === 429 || res.status === 503)
      if (retryable) {
        lastErr = apiErrorFromStatus(res.status, detail, requestId)
        await sleep(this.backoff(attempt, res))
        continue
      }
      throw apiErrorFromStatus(res.status, detail, requestId)
    }

    // Exhausted retries on a retryable HTTP status.
    if (lastErr instanceof MaritimeError) throw lastErr
    throw new MaritimeConnectionError(`Request to ${url} failed after retries`, lastErr)
  }

  private backoff(attempt: number, res?: Response): number {
    // Honour Retry-After (seconds) when the server sends it.
    const retryAfter = res?.headers.get('retry-after')
    if (retryAfter) {
      const secs = Number(retryAfter)
      if (!Number.isNaN(secs)) return Math.min(secs * 1000, 20_000)
    }
    return Math.min(500 * 2 ** attempt, 8_000)
  }

  private async parseBody(res: Response): Promise<unknown> {
    if (res.status === 204) return undefined
    const text = await res.text()
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  private async safeDetail(res: Response): Promise<string> {
    try {
      const body = await this.parseBody(res)
      if (body && typeof body === 'object' && 'detail' in body) {
        const d = (body as { detail: unknown }).detail
        if (typeof d === 'string') return d
        return JSON.stringify(d)
      }
      // /api/v1/computers/* errors are {error, message, retryAfterS}: the
      // message is written for the model that will read it, keep it verbatim.
      if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as { message: unknown }).message
        if (typeof m === 'string' && m) return m
      }
      if (typeof body === 'string' && body) return body
    } catch {
      /* fall through */
    }
    return `Request failed with status ${res.status}`
  }
}
