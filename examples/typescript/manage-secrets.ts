/**
 * Give each customer's agent its own secrets (their API keys, tokens, config).
 * Secrets are encrypted at rest; changes reach a running agent after a reload.
 *
 *   export MARITIME_API_KEY=mk_xxxxxxxxxxxx
 *   npx tsx manage-secrets.ts
 */
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

const agent = await maritime.agents.provision({
  externalId: 'customer_42',
  name: 'assistant-42',
  template: 'openclaw',
})

// Store the customer's own credential on their agent (encrypted at rest).
await maritime.agents.setEnv(agent.id, 'ACME_API_KEY', 'sk-the-customers-key', { secret: true })

// Non-secret config is fine too.
await maritime.agents.setEnv(agent.id, 'ACME_REGION', 'us-east', { secret: false })

// Push the new env into the running container.
await maritime.agents.reloadEnv(agent.id)

// Read them back (secret values come back masked).
for (const v of await maritime.agents.listEnv(agent.id)) {
  console.log(`${v.key} = ${v.value}${v.isSecret ? '  (secret)' : ''}`)
}
