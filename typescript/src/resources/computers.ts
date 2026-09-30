import type { HttpClient } from '../http.js'
import type {
  ActionOptions,
  ActionResult,
  Computer,
  ComputerAction,
  ComputerExecResult,
  ComputerFileList,
  ComputerSession,
  ComputerUsageParams,
  ComputerUsageReport,
  ComputerWakeResult,
  CreateComputerParams,
  ListComputersParams,
  ScreenshotOptions,
  ViewerLink,
  ViewerParams,
} from '../types.js'

const enc = encodeURIComponent
const PREFIX = '/api/v1/computers'

/**
 * Files on a computer's disk, under `/data` or `/home/desk`. Reads and
 * writes wake a sleeping computer but count as neither actions nor
 * invocations. Transfers are capped at 8 MiB. Access via
 * `maritime.computers.files`.
 */
export class ComputerFilesResource {
  constructor(private readonly http: HttpClient) {}

  /** Read a file as raw bytes. */
  async read(computerId: string, path: string): Promise<Uint8Array> {
    return this.http.request<Uint8Array>({
      method: 'GET',
      path: `${PREFIX}/${enc(computerId)}/files`,
      query: { path },
      binary: true,
    })
  }

  /** Write a file (creates or overwrites). Strings are sent UTF-8. */
  async write(computerId: string, path: string, data: Uint8Array | ArrayBuffer | string): Promise<void> {
    const bytes =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data)
    await this.http.request<void>({
      method: 'PUT',
      path: `${PREFIX}/${enc(computerId)}/files`,
      query: { path },
      rawBody: bytes,
    })
  }

  /** List a directory. */
  async list(computerId: string, path: string): Promise<ComputerFileList> {
    return this.http.request<ComputerFileList>({
      method: 'GET',
      path: `${PREFIX}/${enc(computerId)}/files/list`,
      query: { path },
    })
  }
}

/**
 * Computers: one persistent Linux desktop per end user, driven by your own
 * model through canonical actions. Access via `maritime.computers`. Takes the
 * same key as the rest of the API: `manage` or full access drives computers
 * and agents alike. A key whose only scope is `computers` also works here,
 * and is refused everywhere else, so hand that one out when a leak should be
 * contained to this product.
 *
 * ```ts
 * const computer = await maritime.computers.create({ externalUserId: userId })
 * const shot = await maritime.computers.act(computer.id, { action: 'screenshot' })
 * // ...show shot.imageB64 (shot.width x shot.height) to your model...
 * await maritime.computers.act(computer.id, { action: 'left_click', coordinate: [640, 375] })
 * await maritime.computers.closeSession(computer.id)
 * ```
 *
 * Every action wakes a sleeping computer and opens a session (one
 * invocation) if none is open; {@link closeSession} ends it. Coordinates are
 * pixels of the last screenshot's reported `width` x `height`.
 */
export class ComputersResource {
  /** Files on the computer's disk: read / write / list. */
  readonly files: ComputerFilesResource

  constructor(private readonly http: HttpClient) {
    this.files = new ComputerFilesResource(http)
  }

  /**
   * Get-or-create a computer. With `externalUserId` the call is idempotent:
   * the same id always returns the same computer (200 when it already
   * existed, 201 when it was just created). Without it a fresh anonymous
   * computer is created on every call.
   */
  async create(params: CreateComputerParams = {}): Promise<Computer> {
    const body: Record<string, unknown> = {}
    if (params.externalUserId !== undefined) body.externalUserId = params.externalUserId
    if (params.name !== undefined) body.name = params.name
    return this.http.request<Computer>({
      method: 'POST',
      path: PREFIX,
      body,
      // Get-or-create by externalUserId is idempotent by design.
      idempotent: params.externalUserId !== undefined,
    })
  }

  /** List computers, optionally only the one bound to `externalUserId`. */
  async list(params: ListComputersParams = {}): Promise<Computer[]> {
    const res = await this.http.request<{ computers: Computer[] }>({
      method: 'GET',
      path: PREFIX,
      query: { externalUserId: params.externalUserId },
    })
    return res.computers
  }

  /** Fetch one computer. */
  async get(computerId: string): Promise<Computer> {
    return this.http.request<Computer>({ method: 'GET', path: `${PREFIX}/${enc(computerId)}` })
  }

  /** Destroy the computer: its VM, snapshots and data volume. */
  async delete(computerId: string): Promise<void> {
    await this.http.request<void>({ method: 'DELETE', path: `${PREFIX}/${enc(computerId)}` })
  }

  /**
   * Pre-warm a sleeping computer. Idempotent; waking never opens a session.
   * Throws {@link MaritimePaymentRequiredError} (402) when the plan blocks it.
   */
  async wake(computerId: string): Promise<ComputerWakeResult> {
    return this.http.request<ComputerWakeResult>({
      method: 'POST',
      path: `${PREFIX}/${enc(computerId)}/wake`,
      idempotent: true,
    })
  }

  /** Close the open session and snapshot the computer to sleep. */
  async sleep(computerId: string): Promise<Computer> {
    return this.http.request<Computer>({
      method: 'POST',
      path: `${PREFIX}/${enc(computerId)}/sleep`,
      idempotent: true,
    })
  }

  /**
   * Run one canonical action, or a batch in order (the batch halts on the
   * first failure). Each result states `frameId`, `width` and `height` of
   * the screenshot it carries. Throws {@link MaritimeConflictError} (409)
   * while a person holds the desktop, {@link MaritimePaymentRequiredError}
   * (402) when a new session would exceed the plan, and
   * {@link MaritimeRateLimitError} (429) at the concurrency cap.
   */
  act(computerId: string, action: ComputerAction, opts?: ActionOptions): Promise<ActionResult>
  act(computerId: string, actions: ComputerAction[], opts?: ActionOptions): Promise<ActionResult[]>
  async act(
    computerId: string,
    action: ComputerAction | ComputerAction[],
    opts: ActionOptions = {},
  ): Promise<ActionResult | ActionResult[]> {
    const extra: Record<string, unknown> = {}
    if (opts.format !== undefined) extra.format = opts.format
    if (opts.quality !== undefined) extra.quality = opts.quality
    const path = `${PREFIX}/${enc(computerId)}/actions`
    if (Array.isArray(action)) {
      const res = await this.http.request<{ results: ActionResult[] }>({
        method: 'POST',
        path,
        body: { actions: action, ...extra },
      })
      return res.results
    }
    return this.http.request<ActionResult>({ method: 'POST', path, body: { ...action, ...extra } })
  }

  /**
   * Screenshot as raw image bytes (PNG by default). For the frame id and
   * size alongside the image, use `act(id, { action: 'screenshot' })`
   * instead, which returns them as JSON.
   */
  async screenshot(computerId: string, opts: ScreenshotOptions = {}): Promise<Uint8Array> {
    return this.http.request<Uint8Array>({
      method: 'GET',
      path: `${PREFIX}/${enc(computerId)}/screenshot`,
      query: { format: opts.format, quality: opts.quality },
      binary: true,
    })
  }

  /** Run a shell command inside the computer (`timeoutS` at most 30). */
  async exec(computerId: string, command: string, timeoutS?: number): Promise<ComputerExecResult> {
    const body: Record<string, unknown> = { command }
    if (timeoutS !== undefined) body.timeoutS = timeoutS
    return this.http.request<ComputerExecResult>({
      method: 'POST',
      path: `${PREFIX}/${enc(computerId)}/exec`,
      body,
    })
  }

  /**
   * Mint a viewer link. `watch` is read-only; `control` hands the desktop to
   * a person (for logins, CAPTCHAs, payments) until they click Done or
   * Failed, during which actions are refused with 409.
   */
  async viewer(computerId: string, params: ViewerParams = {}): Promise<ViewerLink> {
    const body: Record<string, unknown> = { mode: params.mode ?? 'watch' }
    if (params.ttlS !== undefined) body.ttlS = params.ttlS
    if (params.reason !== undefined) body.reason = params.reason
    return this.http.request<ViewerLink>({
      method: 'POST',
      path: `${PREFIX}/${enc(computerId)}/viewer`,
      body,
    })
  }

  /**
   * End the open session (the invocation) now. The computer sleeps after a
   * short grace; an action inside the grace reopens the same session at no
   * charge. Resolves `undefined` when no session was open.
   */
  async closeSession(computerId: string): Promise<ComputerSession | undefined> {
    return this.http.request<ComputerSession | undefined>({
      method: 'POST',
      path: `${PREFIX}/${enc(computerId)}/sessions/close`,
      idempotent: true,
    })
  }

  /** Sessions (invocations) on a computer, newest first. */
  async sessions(computerId: string): Promise<ComputerSession[]> {
    const res = await this.http.request<{ sessions: ComputerSession[] }>({
      method: 'GET',
      path: `${PREFIX}/${enc(computerId)}/sessions`,
    })
    return res.sessions
  }

  /** Invocations, seconds and actions per computer over a period. */
  async usage(params: ComputerUsageParams = {}): Promise<ComputerUsageReport> {
    return this.http.request<ComputerUsageReport>({
      method: 'GET',
      path: `${PREFIX}/usage`,
      query: { from: params.from, to: params.to, externalUserId: params.externalUserId },
    })
  }
}
