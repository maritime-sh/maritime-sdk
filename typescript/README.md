# maritime-sdk

Official TypeScript SDK for [Maritime](https://maritime.sh) — provision and drive AI agents on Maritime's serverless infrastructure, straight from your own backend.

Build an app where every one of **your** users gets **their own** agent: one call on sign-up spins up an isolated agent on Maritime's fleet; another sends it a message. You never touch a container.

```bash
npm install maritime-sdk
```

Requires Node 18+ (or any runtime with a global `fetch` — Bun, Deno, edge). Zero runtime dependencies.

## Quick start

```ts
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

// When YOUR user signs up, give them their own agent. `provision` is
// idempotent on externalId — safe to call on every login.
const agent = await maritime.agents.provision({
  externalId: `customer_${user.id}`,   // your id for this agent
  name: `assistant-${user.id}`,
  template: 'openclaw',
})

// Talk to it (sleeping agents auto-wake):
const { response } = await maritime.agents.chat(agent.id, 'Summarize my unread email.')
console.log(response)
```

## Authentication

Mint an API key (`mk_...`) from the dashboard (**Settings → API keys**) or the CLI (`maritime keys create`), then:

```ts
const maritime = new Maritime({ apiKey: 'mk_...' })
// or set MARITIME_API_KEY and call new Maritime()
```

Keys carry **scopes** — hand a narrower key to a subsystem that only needs part of the surface:

| Scope | Grants |
|-------|--------|
| `provision` | create agents |
| `deploy` | start/stop/restart/sleep/chat |
| `secrets` | read/write env vars |
| `manage` | everything, incl. delete + key management (wildcard) |

```ts
const worker = await maritime.keys.create({ name: 'chat-worker', scopes: ['deploy'] })
// worker.rawKey is shown once — store it now.
```

## Agents

```ts
// Create (kicks off deploy). Prefer `template` — a bare framework yields a broken image.
const agent = await maritime.agents.create({
  name: 'support-bot',
  template: 'openclaw',
  externalId: 'customer_42',
  instructions: 'You are a friendly support agent for Acme Inc.',
  env: [{ key: 'ACME_API_KEY', value: '...', secret: true }],
  tier: 'smart',            // 'smart' | 'extended' | 'always_on'
  idleTtlSeconds: 3600,     // 0 = always-on
})

// Idempotent get-or-create by externalId (recommended for per-user provisioning)
const agent = await maritime.agents.provision({ externalId: 'customer_42', name: 'support-bot' })

await maritime.agents.get(agent.id)
await maritime.agents.list({ externalId: 'customer_42' })  // filter by your id
await maritime.agents.list()                                // all of your agents

// Chat (synchronous; auto-wakes a sleeping agent)
const { response, error } = await maritime.agents.chat(agent.id, 'Hello')

// Lifecycle
await maritime.agents.start(agent.id)
await maritime.agents.sleep(agent.id)     // cheapest resting state (serverless snapshot)
await maritime.agents.restart(agent.id)
await maritime.agents.delete(agent.id)    // tears down container + volume + network

// Env vars (secrets encrypted at rest; reach a running container after reloadEnv)
await maritime.agents.setEnv(agent.id, 'STRIPE_KEY', 'sk_live_...', { secret: true })
await maritime.agents.listEnv(agent.id)
await maritime.agents.reloadEnv(agent.id)

// Logs
await maritime.agents.logs(agent.id, { limit: 100, level: 'error' })
```

## Errors

Every failure is a subclass of `MaritimeError` — catch the base to catch them all, or narrow by type:

```ts
import {
  MaritimeAuthError,           // 401 / 403 — bad or under-scoped key
  MaritimePaymentRequiredError,// 402 — wallet needs funding
  MaritimeNotFoundError,       // 404 — no such agent (or not yours)
  MaritimeConflictError,       // 409 — name already taken
  MaritimeRateLimitError,      // 429
  MaritimeAPIError,            // any other non-2xx (has .status, .detail)
  MaritimeConnectionError,     // never reached Maritime (network/timeout)
} from 'maritime-sdk'

try {
  await maritime.agents.create({ name: 'dupe', template: 'openclaw' })
} catch (err) {
  if (err instanceof MaritimeConflictError) {
    // an agent with that name already exists
  } else if (err instanceof MaritimeAPIError) {
    console.error(err.status, err.detail, err.requestId)
  }
}
```

## Configuration

```ts
new Maritime({
  apiKey: 'mk_...',                     // or MARITIME_API_KEY
  baseUrl: 'https://api.maritime.sh',   // or MARITIME_API_URL
  timeout: 60_000,                      // per-request ms
  maxRetries: 2,                        // network + 5xx/429 (GET/DELETE and 429/503 only)
  fetch: customFetch,                   // inject a fetch (tests, proxies)
  defaultHeaders: { 'x-team': 'acme' },
})
```

Retries are safe by construction: `GET`/`DELETE` retry on any transient failure; `POST`/`PUT` retry only on network errors and `429`/`503` (never a `5xx` that might have applied a write).

## License

MIT
