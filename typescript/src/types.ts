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
  | 'dsh'
  | (string & {})

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
  /** Template/framework. Strongly recommended: a bare framework yields a broken
   * placeholder image. Defaults to `openclaw` in {@link AgentsResource.provision}. */
  template?: Template
  /** Your own id for this agent (e.g. your end-customer id). Filterable later. */
  externalId?: string
  description?: string
  /** Plain-English persona / system prompt. */
  instructions?: string
  /** Seed env vars (API keys, config). Secrets are encrypted at rest. */
  env?: EnvVarInput[]
  /** Per-agent resource overrides. Every agent includes 2 GB RAM and 5 GB SSD;
   * asking for more, or for always-on, is a paid add-on and needs a plan that
   * allows it (else the create fails with {@link MaritimePaymentRequiredError}). */
  memMb?: number
  vcpus?: number
  /** Idle seconds before auto-sleep. 0 = always-on (a paid add-on). */
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
  /** Vestigial: tiers were retired, every agent gets the top allocation. */
  tier: 'always_on'
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

// --- Skills ---

/** One skill as reported by the agent's runtime registry. */
export interface SkillInfo {
  name: string
  description: string | null
  emoji: string | null
  source: string | null
  homepage: string | null
  /** Present on eligible skills: whether the per-agent allowlist has it on. */
  enabled?: boolean
  /** Present on blocked/unsupported skills: what's missing. */
  missing?: SkillMissing
  /** Missing env keys that are already set in Maritime (apply on restart). */
  env_set?: string[]
}

/** Unmet skill requirements, by kind. */
export interface SkillMissing {
  bins?: string[]
  any_bins?: string[]
  env?: string[]
  config?: string[]
  os?: string[]
}

export interface SkillsOverview {
  agentId: string
  framework: string
  /** null = unrestricted (every eligible skill on); list = explicit allowlist. */
  allowlist: string[] | null
  summary: { eligible: number; blocked: number; unsupported: number; total: number }
  eligible: SkillInfo[]
  blocked: SkillInfo[]
  unsupported: SkillInfo[]
}

/** One entry in an agent volume directory listing. */
export interface AgentFileEntry {
  name: string
  isDir: boolean
  /** Bytes. 0 for directories. */
  size: number
  /** Unix seconds. 0 when unknown. */
  mtime: number
}

export interface AgentFileList {
  /** The listed directory (absolute path inside the container). */
  path: string
  /** The agent's persistent-volume mount. Framework-dependent (`/data` for
   * most, `/zeroclaw-data` for zeroclaw, `/opt/data` for hermes); browse and
   * mutate operations are scoped to it. */
  root: string
  entries: AgentFileEntry[]
}

export interface UploadFileParams {
  /** File bytes; strings are sent UTF-8. */
  content: Uint8Array | ArrayBuffer | string
  /** Filename to record inside the container. */
  filename: string
  /** Exact volume directory to place the file in, keeping `filename` as-is.
   * Omit to deliver as a chat attachment instead: the file lands in the
   * framework's inbox under a timestamped name and the agent is notified in
   * its current conversation. */
  destDir?: string
  /** Optional note passed to the agent with a chat-attachment upload. */
  message?: string
}

export interface UploadFileResult {
  ok: boolean
  /** Absolute in-container path the file landed at. */
  path: string
  name: string
  size: number
}

export interface ExecResult {
  exitCode: number
  stdout: string
  /** Always empty today: runtimes return one merged stream (in `stdout`). */
  stderr: string
}

export interface InstallSkillParams {
  /** ClawHub slug. Exactly one of slug / git. */
  slug?: string
  /** https git URL of a skill repo. */
  git?: string
  version?: string
  force?: boolean
  /** Env values a gated skill needs, applied before the eligibility check. */
  env?: Record<string, string>
}

export interface UploadSkillParams {
  /** Skill archive: a zip of the skill folder or a bare SKILL.md, as raw
   * bytes or an already-base64-encoded string. */
  archive: Uint8Array | ArrayBuffer | string
  /** Install name; defaults to the `name:` in SKILL.md frontmatter. */
  name?: string
  env?: Record<string, string>
}

/** Result of install/upload: the just-works pipeline's final state. */
export interface SkillInstallResult {
  ok: boolean
  name: string
  /** `active` = usable now; `needs_input` = missing.env/config need values
   * (pass them via skills.setEnv or re-call with env); `failed` = see reason. */
  status: 'active' | 'needs_input' | 'failed'
  missing?: SkillMissing
  /** Binary resolution outcomes: bin -> nix|npm|pip|apt|present|failed. */
  resolved?: Record<string, string>
  reason?: string
  output?: string
  [key: string]: unknown
}

export interface SkillSearchResult {
  slug: string
  displayName?: string
  summary?: string
  score?: number
  stats?: Record<string, unknown> | null
  [key: string]: unknown
}

/** An agent's provisioned real-world identity (Identity add-on). */
export interface AgentIdentity {
  /** E.164 phone number, or null if no phone was provisioned. */
  phoneNumber: string | null
  /** Mailbox address (`<handle>@inkboxmail.com`), or null. */
  emailAddress: string | null
  /** Globally-unique identity handle. */
  agentHandle: string | null
  /** Public TLS tunnel host (`<handle>.inkboxwire.com`), or null. */
  tunnelHost: string | null
  /** `'pending'` during new-number warm-up, `'active'` once SMS-ready; null when no phone. */
  smsStatus: string | null
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
  /** Restrict the key to one project: it then only works on the front door +
   * usage endpoints for that project and is rejected everywhere else. The key
   * to put in a partner-facing or per-tenant service. */
  projectId?: string
}

export interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  /** Non-null when the key is restricted to a single project. */
  projectId?: string | null
  isActive: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface CreatedApiKey extends ApiKey {
  /** The full key, shown once. Store it now. */
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
  | 'message.reply'
  | 'message.failed'

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
  /** Signing secret, shown once. Verify `X-Maritime-Signature` with it. */
  secret: string
}

export interface WebhookTestResult {
  delivered: boolean
  statusCode: number | null
  error?: string
}

// --- Projects / HTTP front door ---

export type NewChatPolicy = 'single' | 'assign' | 'spawn' | 'claim'

export interface Project {
  id: string
  name: string
  newChatPolicy: NewChatPolicy
  maxInstances: number
  warmPoolSize: number
  baseAgentId: string | null
  createdAt: string
  [key: string]: unknown
}

export interface UpdateProjectParams {
  name?: string
  /** What happens when an unknown end-user first messages: bind everyone to the
   * source agent, assign to the least-loaded instance, spawn a dedicated one,
   * or require a claim code. `spawn` is the one-agent-per-user mode. */
  newChatPolicy?: NewChatPolicy
  maxInstances?: number
  /** Pre-built unassigned instances kept ready so a new end-user binds in
   * ~1s (snapshot wake) instead of waiting out a cold create. */
  warmPoolSize?: number
}

export interface SendMessageParams {
  /** YOUR end-user's id, opaque to Maritime, 1-128 chars of [A-Za-z0-9_@.:+-].
   * The same id always reaches the same agent. */
  externalUserId: string
  message: string
  /** Seconds (0-60, default 30) to wait for the reply inline. Within budget →
   * 200 + `reply`; otherwise 202 → poll {@link ProjectsResource.getMessage} or
   * receive a `message.reply` webhook. */
  wait?: number
  /** Claim code, for projects with `newChatPolicy: 'claim'`. */
  claimCode?: string
  /** Human-readable label stored on the binding (your user's name). */
  displayName?: string
  /** Opaque passthrough echoed on reads and reply webhooks. */
  metadata?: Record<string, unknown>
  /** Dedupe key: retries with the same key return the original message instead
   * of delivering twice. Strongly recommended for at-least-once senders. */
  idempotencyKey?: string
}

export type MessageStatus = 'queued' | 'provisioning' | 'replied' | 'failed'

export interface ProjectMessage {
  messageId: string
  externalUserId: string
  agentId: string
  status: MessageStatus
  /** The agent's reply (present when status is `replied`). */
  reply: string | null
  /** Delivery failure detail (present when status is `failed`). */
  error: string | null
  /** True when this message caused a fresh agent to be bound for the user. */
  userCreated: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
  repliedAt: string | null
}

export interface ProjectUser {
  externalUserId: string
  agentId: string
  agentStatus: AgentStatus | null
  displayName: string | null
  messageCount: number
  lastActiveAt: string | null
  createdAt: string
}

// --- Usage / billing ---

export interface UsageParams {
  /** ISO date/datetime start (default: `to` minus 30 days). */
  from?: string
  /** ISO date/datetime end (default: now). Range is capped at 92 days. */
  to?: string
  /** Only agents in this project. */
  projectId?: string
  /** Only the agent(s) attributed to this end-user id. */
  externalUserId?: string
}

export interface AgentUsage {
  agentId: string
  /** Null for deleted agents: their spend history is retained. */
  agentName: string | null
  externalUserId: string | null
  projectId: string | null
  /** Legacy metered-hosting figure. Plans are flat monthly and nothing is
   * metered by time, so this reads 0 for periods billed under a plan. */
  computeMinutes: number
  /** Legacy metered-hosting spend (cents), same caveat as `computeMinutes`.
   * What your plan itself costs is on your Stripe invoices, not here. */
  hostingCostCents: number
  /** AI budget spent on this agent's LLM tokens (cents). The per-agent
   * number that actually moves, and the one to rebill. */
  llmCostCents: number
  totalCostCents: number
}

export interface UsageReport {
  periodStart: string
  periodEnd: string
  computeMinutes: number
  hostingCostCents: number
  llmCostCents: number
  totalCostCents: number
  /** Sorted by totalCostCents descending. */
  agents: AgentUsage[]
}

// --- Computers (one persistent desktop per end user) ---

export type ComputerStatus = 'creating' | 'ready' | 'sleeping' | 'waking' | 'error' | 'deleting'

/** How the last wake (or boot) happened, reported for observability. */
export type ComputerWakeMethod = 'golden' | 'cold' | 'restore' | 'reattach' | 'already_running'

export interface ComputerScreen {
  /** Physical width in pixels. */
  width: number
  /** Physical height in pixels. */
  height: number
  /** Width of the frame the model sees; screenshots and coordinates use it. */
  modelWidth: number
}

export interface Computer {
  id: string
  /** Your end user's id. Null for anonymous computers. */
  externalUserId: string | null
  name: string | null
  status: ComputerStatus
  screen: ComputerScreen
  /** `agent` normally; `human` while a person holds the desktop via a control link. */
  mode: 'agent' | 'human' | (string & {})
  modeReason: string | null
  takeoverSeq: number | null
  takeoverExpiresAt: string | null
  lastActionAt: string | null
  lastWakeMs: number | null
  lastWakeMethod: ComputerWakeMethod | null
  createdAt: string
}

export interface CreateComputerParams {
  /** Your end user's id. Get-or-create: the same id always returns the same
   * computer. Omit to create an anonymous computer every time. */
  externalUserId?: string
  name?: string
}

export interface ListComputersParams {
  externalUserId?: string
}

export interface ComputerWakeResult {
  status: ComputerStatus
  wakeMs: number | null
  method: ComputerWakeMethod | null
}

/** The 17 canonical desktopd actions. */
export type ComputerActionName =
  | 'screenshot'
  | 'left_click'
  | 'right_click'
  | 'middle_click'
  | 'double_click'
  | 'triple_click'
  | 'mouse_move'
  | 'left_click_drag'
  | 'left_mouse_down'
  | 'left_mouse_up'
  | 'scroll'
  | 'type'
  | 'key'
  | 'hold_key'
  | 'wait'
  | 'zoom'
  | 'cursor_position'

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

export type ScreenshotFormat = 'png' | 'jpeg'

/**
 * One canonical computer action, in the camelCase REST shape. Coordinates are
 * pixels in the frame of the most recent screenshot (its reported
 * `width` x `height`, 1200x750 by default).
 */
export interface ComputerAction {
  action: ComputerActionName
  /** `[x, y]` for clicks, moves, drags (the end point) and scroll. */
  coordinate?: [number, number]
  /** `left_click_drag` start `[x, y]`. */
  startCoordinate?: [number, number]
  /** `type`: the text to type. `key` / `hold_key`: xdotool key name (alias of `key`). */
  text?: string
  /** Clicks and scroll: key held during the action, e.g. `ctrl` or `ctrl+shift`. */
  modifier?: string
  /** `key` / `hold_key`: xdotool key name, e.g. `Return`, `ctrl+s`. */
  key?: string
  /** `key`: repeat count, 1 to 100. */
  repeat?: number
  scrollDirection?: ScrollDirection
  /** Wheel clicks, 1 to 100. */
  scrollAmount?: number
  /** `wait` / `hold_key`: seconds. */
  duration?: number
  /** `zoom`: `[x0, y0, x1, y1]` crop in screenshot coordinates. */
  region?: [number, number, number, number]
  /** Skip the post-action screenshot. */
  noScreenshot?: boolean
}

export interface ActionOptions {
  /** Screenshot encoding. The REST default is `png`. */
  format?: ScreenshotFormat
  /** JPEG quality, 1 to 95 (default 80). */
  quality?: number
}

export interface ScreenshotOptions extends ActionOptions {}

/**
 * The result of one action. Every result states `width`, `height` and
 * `frameId` of the image it carries, so a converter can map the model's next
 * coordinates back onto it. Extra detail keys pass through.
 */
export interface ActionResult {
  action?: string
  ok?: boolean
  isError?: boolean
  error?: string
  frameId?: number
  /** Base64 image bytes (see `mime`). Absent when `noScreenshot` was set. */
  imageB64?: string
  width?: number
  height?: number
  mime?: string
  scale?: number
  coordinate?: [number, number] | number[]
  blocked?: boolean
  mode?: string
  reason?: string
  hint?: string
  note?: string
  [key: string]: unknown
}

export interface ComputerExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface ComputerFileEntry {
  name: string
  size: number
  isDir: boolean
  /** Unix seconds. */
  mtime: number | null
}

export interface ComputerFileList {
  path: string
  entries: ComputerFileEntry[]
}

export type ViewerMode = 'watch' | 'control'

export interface ViewerParams {
  /** `watch` (read-only) or `control` (hands the desktop to a person until
   * they click Done or Failed). Default `watch`. */
  mode?: ViewerMode
  /** Link lifetime in seconds, 30 to 3600 (default 600). */
  ttlS?: number
  /** Shown to the person taking control. */
  reason?: string
}

export interface ViewerLink {
  url: string
  expiresAt: string
  mode: ViewerMode
}

export type ComputerSessionEnd = 'closed' | 'idle' | 'wall_cap' | 'error' | 'deleted'

/** One invocation: a session row on a computer. */
export interface ComputerSession {
  id: string
  computerId: string
  startedAt: string
  lastActionAt: string
  endedAt: string | null
  wallSeconds: number
  actions: number
  screenshots: number
  bytesOut: number
  invocationsCharged: number
  endReason: ComputerSessionEnd | null
  client: string | null
  modelHint: string | null
  graceUntil: string | null
}

export interface ComputerUsageParams {
  /** ISO date/datetime start (default: `to` minus 30 days). */
  from?: string
  /** ISO date/datetime end (default: now). */
  to?: string
  externalUserId?: string
}

export interface ComputerUsageRow {
  computerId: string
  externalUserId: string | null
  invocations: number
  wallSeconds: number
  actions: number
  screenshots: number
}

export interface ComputerUsageReport {
  from: string
  to: string
  invocations: number
  wallSeconds: number
  actions: number
  screenshots: number
  computers: ComputerUsageRow[]
}
