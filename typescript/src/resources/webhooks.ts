import type { HttpClient } from '../http.js'
import type { CreatedWebhook, CreateWebhookParams, Webhook, WebhookTestResult } from '../types.js'

/**
 * Manage outbound webhook subscriptions. Access via `maritime.webhooks`.
 *
 * Subscribe a URL to receive signed agent lifecycle events (agent.deployed,
 * agent.error, agent.sleeping, agent.woken, agent.restarted, agent.stopped)
 * instead of polling. Each delivery carries an `X-Maritime-Signature:
 * sha256=<hmac>` header — verify it with the subscription's secret. The event
 * body includes the agent's `external_id` so you can route to your own customer.
 */
export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a subscription. The signing `secret` is returned once. */
  async create(params: CreateWebhookParams): Promise<CreatedWebhook> {
    return this.http.request<CreatedWebhook>({
      method: 'POST',
      path: '/api/v1/webhooks',
      body: { url: params.url, events: params.events ?? [] },
    })
  }

  /** List your subscriptions (secrets are never returned again). */
  async list(): Promise<Webhook[]> {
    return this.http.request<Webhook[]>({ method: 'GET', path: '/api/v1/webhooks' })
  }

  /** Delete a subscription. */
  async delete(id: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: `/api/v1/webhooks/${encodeURIComponent(id)}`,
    })
  }

  /** Send a synthetic `ping` to the subscription's URL and return the result. */
  async test(id: string): Promise<WebhookTestResult> {
    return this.http.request<WebhookTestResult>({
      method: 'POST',
      path: `/api/v1/webhooks/${encodeURIComponent(id)}/test`,
    })
  }
}
