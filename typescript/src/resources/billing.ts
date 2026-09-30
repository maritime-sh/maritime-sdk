import type { HttpClient } from '../http.js'
import type { UsageParams, UsageReport } from '../types.js'

/**
 * Usage & cost rollups for rebilling. Access via `maritime.billing`.
 *
 * The report is per-agent LLM spend out of your AI budget, the number to pass
 * through to your own customers. Each row carries `externalUserId` (the front
 * door binding's key, or the agent's `externalId`), so grouping by YOUR user
 * is a client-side one-liner.
 *
 * What your plan itself costs is not here: plans are a flat monthly
 * subscription, so that lives on your Stripe invoices at
 * https://maritime.sh/billing.
 *
 * ```ts
 * const report = await maritime.billing.usage({
 *   from: '2026-07-01', to: '2026-08-01', projectId,
 * })
 * for (const row of report.agents) {
 *   invoice(row.externalUserId, row.totalCostCents)
 * }
 * ```
 */
export class BillingResource {
  constructor(private readonly http: HttpClient) {}

  /** Per-agent / per-end-user cost rollup over a date range (max 92 days). */
  async usage(params: UsageParams = {}): Promise<UsageReport> {
    return this.http.request<UsageReport>({
      method: 'GET',
      path: '/api/v1/usage',
      query: {
        from: params.from,
        to: params.to,
        projectId: params.projectId,
        externalUserId: params.externalUserId,
      },
    })
  }
}
