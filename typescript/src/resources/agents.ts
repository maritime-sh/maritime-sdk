import type { HttpClient } from '../http.js'
import type {
  Agent,
  AgentFileList,
  AgentIdentity,
  ChatOptions,
  ChatResult,
  CreateAgentParams,
  EnvVar,
  ExecResult,
  InstallSkillParams,
  ListAgentsParams,
  LogEntry,
  SkillInstallResult,
  SkillSearchResult,
  SkillsOverview,
  UploadFileParams,
  UploadFileResult,
  UploadSkillParams,
} from '../types.js'

/**
 * Skills on an agent: list what's available, install from ClawHub / git /
 * an uploaded archive, and remove or export custom skills. Install and
 * upload run the "just works" pipeline server-side: missing binaries are
 * auto-resolved inside the agent's own VM, and the result tells you the
 * one thing (if any) still needed from a human (`needs_input` + the env
 * key names). Access via `maritime.agents.skills`.
 */
export class AgentSkillsResource {
  constructor(private readonly http: HttpClient) {}

  /** The agent's full skill registry: eligible / blocked / unsupported. */
  async list(agentId: string): Promise<SkillsOverview> {
    return this.http.request<SkillsOverview>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/skills`,
    })
  }

  /** Search ClawHub (OpenClaw's public skill marketplace). */
  async search(agentId: string, q: string, opts: { limit?: number } = {}): Promise<SkillSearchResult[]> {
    const res = await this.http.request<{ results: SkillSearchResult[] }>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/skills/search`,
      query: { q, limit: opts.limit },
    })
    return res.results
  }

  /** Install from ClawHub (`{slug}`) or a git repo (`{git}`). */
  async install(agentId: string, params: InstallSkillParams): Promise<SkillInstallResult> {
    return this.http.request<SkillInstallResult>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/skills/install`,
      body: {
        slug: params.slug,
        git: params.git,
        version: params.version,
        force: params.force,
        env: params.env,
      },
    })
  }

  /** Install a CUSTOM skill from an uploaded zip or bare SKILL.md. */
  async upload(agentId: string, params: UploadSkillParams): Promise<SkillInstallResult> {
    return this.http.request<SkillInstallResult>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/skills/upload`,
      body: {
        archiveBase64: toBase64(params.archive),
        name: params.name,
        env: params.env,
      },
    })
  }

  /** Provide env values a `needs_input` skill is waiting on (hot-applied). */
  async setEnv(agentId: string, env: Record<string, string>): Promise<void> {
    await this.http.request<unknown>({
      method: 'PUT',
      path: `/api/agents/${enc(agentId)}/skills/env`,
      body: { env },
    })
  }

  /** Replace the per-agent allowlist. `null` = unrestricted. */
  async setAllowlist(agentId: string, allowlist: string[] | null): Promise<void> {
    await this.http.request<unknown>({
      method: 'PUT',
      path: `/api/agents/${enc(agentId)}/skills/allowlist`,
      body: { allowlist },
    })
  }

  /** Remove an installed (custom or hub) skill from the agent. */
  async remove(agentId: string, name: string): Promise<void> {
    await this.http.request<unknown>({
      method: 'DELETE',
      path: `/api/agents/${enc(agentId)}/skills/${enc(name)}`,
    })
  }

  /** Download a skill as a .tar.gz (the mirror of {@link upload}). */
  async export(agentId: string, name: string): Promise<Uint8Array> {
    return this.http.request<Uint8Array>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/skills/${enc(name)}/export`,
      binary: true,
    })
  }
}

/**
 * Files on an agent's disk: browse, download, upload, edit, organize.
 * Access via `maritime.agents.files`.
 *
 * Browse/mutate operations are scoped to the agent's persistent volume
 * (see {@link AgentFileList.root}); download may read any absolute
 * in-container path, since agents produce files in /tmp and workspace
 * directories too. Any file operation wakes a sleeping serverless agent.
 * Transfers are capped at 100 MB per file in both directions.
 */
export class AgentFilesResource {
  constructor(private readonly http: HttpClient) {}

  /** List a directory in the agent's volume. Defaults to the volume root. */
  async list(agentId: string, path?: string): Promise<AgentFileList> {
    return this.http.request<AgentFileList>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/files/list`,
      query: { path },
    })
  }

  /** Download a file (any absolute in-container path) as raw bytes. */
  async download(agentId: string, path: string): Promise<Uint8Array> {
    return this.http.request<Uint8Array>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/files/download`,
      query: { path },
      binary: true,
    })
  }

  /**
   * Push a file into the agent's container. With `destDir`, the file is
   * placed in that exact volume directory; without it, it's delivered as a
   * chat attachment (framework inbox + a notice in the agent's conversation).
   * Returns the in-container path the file landed at.
   */
  async upload(agentId: string, params: UploadFileParams): Promise<UploadFileResult> {
    const form = new FormData()
    const blob =
      typeof params.content === 'string'
        ? new Blob([params.content])
        : new Blob([params.content instanceof Uint8Array ? (params.content as Uint8Array<ArrayBuffer>) : params.content])
    form.append('file', blob, params.filename)
    if (params.destDir !== undefined) form.append('dest_dir', params.destDir)
    if (params.message !== undefined) form.append('message', params.message)
    return this.http.request<UploadFileResult>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/files/upload`,
      multipart: form,
    })
  }

  /** Write a UTF-8 text file in the volume (creates or overwrites). */
  async write(agentId: string, path: string, content: string): Promise<void> {
    await this.http.request<unknown>({
      method: 'PUT',
      path: `/api/agents/${enc(agentId)}/files/write`,
      body: { path, content },
    })
  }

  /** Create a directory (`mkdir -p`) in the volume. */
  async mkdir(agentId: string, path: string): Promise<void> {
    await this.http.request<unknown>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/files/mkdir`,
      body: { path },
    })
  }

  /**
   * Move or rename within the volume. Missing parents of `to` are created.
   * Throws {@link MaritimeConflictError} (409) if the destination already
   * exists and {@link MaritimeNotFoundError} (404) if the source doesn't.
   */
  async move(agentId: string, from: string, to: string): Promise<void> {
    await this.http.request<unknown>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/files/move`,
      body: { from, to },
    })
  }

  /** Delete a file or directory (recursive). 404 if it doesn't exist. */
  async delete(agentId: string, path: string): Promise<void> {
    await this.http.request<unknown>({
      method: 'DELETE',
      path: `/api/agents/${enc(agentId)}/files/delete`,
      query: { path },
    })
  }
}

/** Operations on Maritime agents. Access via `maritime.agents`. */
export class AgentsResource {
  /** Skill management: list / search / install / upload / remove / export. */
  readonly skills: AgentSkillsResource
  /** Files on the agent's disk: browse / download / upload / edit / organize. */
  readonly files: AgentFilesResource

  constructor(private readonly http: HttpClient) {
    this.skills = new AgentSkillsResource(http)
    this.files = new AgentFilesResource(http)
  }

  /**
   * Create a new agent and kick off its deploy.
   *
   * Throws {@link MaritimePaymentRequiredError} (402) when a billing gate
   * refuses the create, for instance the plan's agent cap. Its `.detail` is
   * the server's complete sentence naming the fix and the billing link, so
   * show it to your user as-is.
   */
  async create(params: CreateAgentParams): Promise<Agent> {
    return this.http.request<Agent>({
      method: 'POST',
      path: '/api/agents',
      body: toCreateBody(params),
    })
  }

  /**
   * Get-or-create an agent by `externalId`: the idempotent entry point for a
   * "one agent per end-customer" flow. If an agent with that external id
   * already exists it is returned; otherwise a new one is created. Safe to call
   * on every sign-in.
   */
  async provision(params: CreateAgentParams & { externalId: string }): Promise<Agent> {
    const existing = await this.list({ externalId: params.externalId })
    if (existing.length > 0) return existing[0] as Agent
    // Default the template so we never create a broken bare-framework agent.
    const withTemplate: CreateAgentParams = {
      template: 'openclaw',
      ...params,
    }
    try {
      return await this.create(withTemplate)
    } catch (err) {
      // Lost a race with a concurrent provisioner (unique-name 409). Re-read.
      const raced = await this.list({ externalId: params.externalId })
      if (raced.length > 0) return raced[0] as Agent
      throw err
    }
  }

  /** Fetch a single agent by id. */
  async get(agentId: string): Promise<Agent> {
    return this.http.request<Agent>({ method: 'GET', path: `/api/agents/${enc(agentId)}` })
  }

  /** List agents, optionally filtered by `externalId` or `name`. */
  async list(params: ListAgentsParams = {}): Promise<Agent[]> {
    return this.http.request<Agent[]>({
      method: 'GET',
      path: '/api/agents',
      query: { externalId: params.externalId, name: params.name },
    })
  }

  /**
   * Send a message to an agent and wait for its reply. Sleeping serverless
   * agents auto-wake. Returns `{ response }` (or `{ response: null, error }`
   * if delivery failed; Maritime does not surface that as an HTTP error).
   */
  async chat(agentId: string, message: string, opts: ChatOptions = {}): Promise<ChatResult> {
    return this.http.request<ChatResult>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/chat`,
      body: { message, conversation_id: opts.conversationId },
    })
  }

  /** Start / wake an agent. */
  async start(agentId: string): Promise<Agent> {
    return this.lifecycle(agentId, 'start')
  }

  /** Stop an agent (container stopped, state preserved). */
  async stop(agentId: string): Promise<Agent> {
    return this.lifecycle(agentId, 'stop')
  }

  /** Put an agent to sleep (serverless snapshot; cheapest resting state). */
  async sleep(agentId: string): Promise<Agent> {
    return this.lifecycle(agentId, 'sleep')
  }

  /** Restart an agent. */
  async restart(agentId: string): Promise<Agent> {
    return this.lifecycle(agentId, 'restart')
  }

  /** Delete an agent and all its resources (container, volume, network). */
  async delete(agentId: string): Promise<void> {
    await this.http.request<void>({ method: 'DELETE', path: `/api/agents/${enc(agentId)}` })
  }

  /** List an agent's env vars (secret values are masked). */
  async listEnv(agentId: string): Promise<EnvVar[]> {
    return this.http.request<EnvVar[]>({ method: 'GET', path: `/api/agents/${enc(agentId)}/env` })
  }

  /**
   * Set (upsert) an env var. Secrets are encrypted at rest. Changes reach a
   * running container after {@link reloadEnv} or a restart.
   */
  async setEnv(
    agentId: string,
    key: string,
    value: string,
    opts: { secret?: boolean } = {},
  ): Promise<EnvVar> {
    return this.http.request<EnvVar>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/env`,
      body: { key, value, isSecret: opts.secret ?? true },
    })
  }

  /** Delete an env var. */
  async deleteEnv(agentId: string, key: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: `/api/agents/${enc(agentId)}/env/${enc(key)}`,
    })
  }

  /** Hot-reload env vars into the running container (falls back to restart). */
  async reloadEnv(agentId: string): Promise<Agent> {
    return this.lifecycle(agentId, 'reload-env')
  }

  /**
   * Change an agent's RAM / SSD allocation or always-on state. RAM and disk
   * apply on the next restart; always-on applies immediately. On seat-billing
   * accounts the response includes a billing preview (flat monthly price and
   * the prorated remainder for the current month); add-ons need a paid plan.
   * Pass `null` to clear a value back to the base allocation.
   */
  async resize(
    agentId: string,
    params: { memMb?: number | null; diskGb?: number | null; alwaysOn?: boolean },
  ): Promise<{
    ok: boolean
    memMb: number | null
    diskGb: number | null
    alwaysOn: boolean
    appliesOn: string
    billingPreview: { monthlyCents: number; thisMonthCents: number } | null
  }> {
    const body: Record<string, unknown> = {}
    if ('memMb' in params) body.mem_mb = params.memMb
    if ('diskGb' in params) body.disk_gb = params.diskGb
    if ('alwaysOn' in params) body.always_on = params.alwaysOn
    return this.http.request({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/resize`,
      body,
    })
  }

  /**
   * Fetch the agent's real-world identity (phone number, email address,
   * tunnel host) provisioned via the Identity add-on. Only meaningful for
   * `openclaw_identity` agents or agents with the add-on enabled; throws
   * {@link MaritimeAPIError} (400) for agents without it. Channels that were
   * never provisioned come back `null` (e.g. an email-only agent has
   * `phoneNumber: null`), and a fresh phone number reports
   * `smsStatus: 'pending'` during carrier warm-up (~10-15 min).
   */
  async identity(agentId: string): Promise<AgentIdentity> {
    return this.http.request<AgentIdentity>({
      method: 'GET',
      path: `/api/inkbox/${enc(agentId)}`,
    })
  }

  /**
   * Run a one-shot, non-interactive shell command in the agent's container
   * (what `maritime exec` uses). Pass argv tokens as an array to have them
   * shell-quoted for you, or a raw shell string. Wakes a sleeping agent.
   * `timeout` is in seconds (default 60, max 120); output is capped at
   * 256 KB. Runtimes return one merged stream, so `stderr` is always empty.
   */
  async exec(
    agentId: string,
    command: string | string[],
    opts: { timeout?: number } = {},
  ): Promise<ExecResult> {
    return this.http.request<ExecResult>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/exec`,
      body: { command, timeout: opts.timeout },
    })
  }

  /** Fetch recent log entries for an agent. */
  async logs(
    agentId: string,
    opts: { limit?: number; level?: string } = {},
  ): Promise<LogEntry[]> {
    return this.http.request<LogEntry[]>({
      method: 'GET',
      path: `/api/agents/${enc(agentId)}/logs`,
      query: { limit: opts.limit, level: opts.level },
    })
  }

  private lifecycle(agentId: string, action: string): Promise<Agent> {
    return this.http.request<Agent>({
      method: 'POST',
      path: `/api/agents/${enc(agentId)}/${action}`,
      // Lifecycle transitions are effectively idempotent; safe to retry.
      idempotent: true,
    })
  }
}

const enc = encodeURIComponent

function toBase64(data: Uint8Array | ArrayBuffer | string): string {
  if (typeof data === 'string') return data // already base64
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  // Node fast path; browser fallback via btoa on a binary string.
  const B = (globalThis as { Buffer?: { from(d: Uint8Array): { toString(e: string): string } } }).Buffer
  if (B) return B.from(bytes).toString('base64')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function toCreateBody(p: CreateAgentParams): Record<string, unknown> {
  return {
    name: p.name,
    templateId: p.template,
    externalId: p.externalId,
    description: p.description,
    instructions: p.instructions,
    memMb: p.memMb,
    vcpus: p.vcpus,
    idleTtlSeconds: p.idleTtlSeconds,
    diskGb: p.diskGb,
    githubRepo: p.githubRepo,
    imageName: p.imageName,
    initialEnvVars: p.env?.map((e) => ({
      key: e.key,
      value: e.value,
      isSecret: e.secret ?? true,
    })),
  }
}
