import { HttpClient, type MaritimeClientOptions } from './http.js'
import { AgentsResource } from './resources/agents.js'
import { BillingResource } from './resources/billing.js'
import { ComputersResource } from './resources/computers.js'
import { KeysResource } from './resources/keys.js'
import { ProjectsResource } from './resources/projects.js'
import { WebhooksResource } from './resources/webhooks.js'

export type { MaritimeClientOptions } from './http.js'
export * from './types.js'
export { verifyWebhookSignature } from './webhook-verify.js'
export {
  DialectError,
  KEY_MAP_OPENAI,
  QWEN_TERMINAL_ACTIONS,
  SCROLL_PX_PER_CLICK,
  fromGemini,
  fromOpenAI,
  fromQwen,
  mapKeyToken,
  pxToWheelClicks,
  toOpenAIScreenshot,
  type Dialect,
  type DialectErrorCode,
  type Frame,
  type GeminiComputerAction,
  type GeminiOptions,
  type OpenAIComputerAction,
  type OpenAIComputerScreenshot,
  type QwenComputerAction,
} from './computers/dialects.js'
export {
  pushSchedules,
  observeScheduler,
  type ScheduleView,
  type AgentScheduleOptions,
  type ObserveSchedulerOptions,
} from './agent-schedules.js'
export {
  MaritimeError,
  MaritimeConnectionError,
  MaritimeAPIError,
  MaritimeAuthError,
  MaritimePaymentRequiredError,
  MaritimeNotFoundError,
  MaritimeConflictError,
  MaritimeRateLimitError,
} from './errors.js'

/**
 * The Maritime client. Provision and drive AI agents on Maritime's serverless
 * infrastructure from your own backend.
 *
 * ```ts
 * import { Maritime } from 'maritime-sdk'
 *
 * const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })
 *
 * // When YOUR user signs up, give them their own agent (idempotent):
 * const agent = await maritime.agents.provision({
 *   externalId: `customer_${userId}`,
 *   name: `assistant-${userId}`,
 *   template: 'openclaw',
 * })
 *
 * const { response } = await maritime.agents.chat(agent.id, 'Hello!')
 *
 * // Or give each of YOUR users a persistent desktop your own model drives:
 * const computer = await maritime.computers.create({ externalUserId: userId })
 * const shot = await maritime.computers.act(computer.id, { action: 'screenshot' })
 *
 * // Or run one agent per end-user through the project front door:
 * const msg = await maritime.projects.message(agent.projectId, {
 *   externalUserId: `user_${userId}`,
 *   message: 'Hello!',
 * })
 * ```
 */
export class Maritime {
  readonly agents: AgentsResource
  readonly billing: BillingResource
  /** Computers: one persistent desktop per end user (needs a `computers` key). */
  readonly computers: ComputersResource
  readonly keys: KeysResource
  readonly projects: ProjectsResource
  readonly webhooks: WebhooksResource
  /** The underlying transport, an escape hatch for endpoints not yet wrapped. */
  readonly http: HttpClient

  constructor(options: MaritimeClientOptions = {}) {
    this.http = new HttpClient(options)
    this.agents = new AgentsResource(this.http)
    this.billing = new BillingResource(this.http)
    this.computers = new ComputersResource(this.http)
    this.keys = new KeysResource(this.http)
    this.projects = new ProjectsResource(this.http)
    this.webhooks = new WebhooksResource(this.http)
  }
}

export default Maritime
