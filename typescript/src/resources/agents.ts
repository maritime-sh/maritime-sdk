import type { HttpClient } from '../http.js'
import type {
  Agent,
  ChatOptions,
  ChatResult,
  CreateAgentParams,
  EnvVar,
  ListAgentsParams,
  LogEntry,
} from '../types.js'

/** Operations on Maritime agents. Access via `maritime.agents`. */
export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a new agent and kick off its deploy. */
  async create(params: CreateAgentParams): Promise<Agent> {
    return this.http.request<Agent>({
      method: 'POST',
      path: '/api/agents',
      body: toCreateBody(params),
    })
  }

  /**
   * Get-or-create an agent by `externalId` — the idempotent entry point for a
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
   * if delivery failed — Maritime does not surface that as an HTTP error).
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

function toCreateBody(p: CreateAgentParams): Record<string, unknown> {
  return {
    name: p.name,
    templateId: p.template,
    externalId: p.externalId,
    description: p.description,
    instructions: p.instructions,
    tier: p.tier,
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
