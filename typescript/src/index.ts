import { HttpClient, type MaritimeClientOptions } from './http.js'
import { AgentsResource } from './resources/agents.js'
import { KeysResource } from './resources/keys.js'
import { WebhooksResource } from './resources/webhooks.js'

export type { MaritimeClientOptions } from './http.js'
export * from './types.js'
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
 * ```
 */
export class Maritime {
  readonly agents: AgentsResource
  readonly keys: KeysResource
  readonly webhooks: WebhooksResource
  /** The underlying transport — escape hatch for endpoints not yet wrapped. */
  readonly http: HttpClient

  constructor(options: MaritimeClientOptions = {}) {
    this.http = new HttpClient(options)
    this.agents = new AgentsResource(this.http)
    this.keys = new KeysResource(this.http)
    this.webhooks = new WebhooksResource(this.http)
  }
}

export default Maritime
