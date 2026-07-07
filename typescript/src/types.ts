/** Framework/template ids accepted by Maritime. Any string is allowed (the API
 * is the source of truth) but these are the common ones with editor help. */
export type Template =
  | 'openclaw'
  | 'openclaw_identity'
  | 'openclaw_browser'
  | 'maritime'
  | 'hermes'
  | 'hermes_identity'
  | 'zeroclaw'
  | (string & {})

export type Tier = 'smart' | 'extended' | 'always_on'

export type AgentStatus = 'sleeping' | 'active' | 'deploying' | 'error' | 'stopped'

/** One env var to seed at create time. */
export interface EnvVarInput {
  key: string
  value: string
  /** Encrypt at rest + mask in reads. Defaults to true. */
  secret?: boolean
}

export interface CreateAgentParams {
  /** Unique (per account) agent name. */
  name: string
  /** Template/framework. Strongly recommended — a bare framework yields a broken
   * placeholder image. Defaults to `openclaw` in {@link AgentsResource.provision}. */
  template?: Template
  /** Your own id for this agent (e.g. your end-customer id). Filterable later. */
  externalId?: string
  description?: string
  /** Plain-English persona / system prompt. */
  instructions?: string
  tier?: Tier
  /** Seed env vars (API keys, config). Secrets are encrypted at rest. */
  env?: EnvVarInput[]
  /** Per-agent resource overrides (else the tier default applies). */
  memMb?: number
  vcpus?: number
  /** Idle seconds before auto-sleep. 0 = always-on. */
  idleTtlSeconds?: number
  diskGb?: number
  /** GitHub repo to build from instead of a template image. */
  githubRepo?: string
  /** Explicit Docker image (advanced; usually use `template`). */
  imageName?: string
}

export interface Agent {
  id: string
  name: string
  description: string | null
  externalId: string | null
  framework: string
  tier: Tier
  status: AgentStatus
  publicUrl?: string | null
  invocationCount: number
  totalComputeSeconds: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface EnvVar {
  key: string
  value: string
  isSecret: boolean
}

export interface LogEntry {
  id: string
  level: string
  message: string
  source?: string | null
  timestamp: string | null
}

export interface ChatResult {
  /** The agent's reply, or null if delivery failed (see `error`). */
  response: string | null
  error?: string
}

export interface ListAgentsParams {
  /** Exact-match filter on the caller-supplied external id. */
  externalId?: string
  /** Exact-match filter on agent name. */
  name?: string
}

export interface ChatOptions {
  conversationId?: string
}

// --- API keys ---

export type ApiKeyScope = 'provision' | 'deploy' | 'secrets' | 'manage' | (string & {})

export interface CreateApiKeyParams {
  name: string
  /** Defaults to a full-access key. Pass a narrower set to restrict it. */
  scopes?: ApiKeyScope[]
  /** Expiry in days from now. Omit for a non-expiring key. */
  expiresInDays?: number
}

export interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface CreatedApiKey extends ApiKey {
  /** The full key — shown once. Store it now. */
  rawKey: string
}

// --- Webhooks ---

export type WebhookEvent =
  | 'agent.deployed'
  | 'agent.error'
  | 'agent.sleeping'
  | 'agent.woken'
  | 'agent.restarted'
  | 'agent.stopped'

export interface CreateWebhookParams {
  /** HTTPS endpoint that will receive POSTed events. */
  url: string
  /** Events to receive. Omit or empty for all events. */
  events?: WebhookEvent[]
}

export interface Webhook {
  id: string
  url: string
  events: WebhookEvent[]
  isActive: boolean
  lastDeliveredAt: string | null
  lastStatusCode: number | null
  consecutiveFailures: number
  createdAt: string
}

export interface CreatedWebhook extends Webhook {
  /** Signing secret — shown once. Verify `X-Maritime-Signature` with it. */
  secret: string
}

export interface WebhookTestResult {
  delivered: boolean
  statusCode: number | null
  error?: string
}
