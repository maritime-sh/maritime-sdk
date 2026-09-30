# maritime-sdk

Official TypeScript SDK for [Maritime](https://maritime.sh): provision and drive AI agents on Maritime's serverless infrastructure, straight from your own backend.

Build an app where every one of **your** users gets **their own** agent: one call on sign-up spins up an isolated agent on Maritime's infrastructure; another sends it a message. You never touch a container.

```bash
npm install maritime-sdk
```

Requires Node 18+ (or any runtime with a global `fetch`: Bun, Deno, edge). Zero runtime dependencies.

## Quick start

```ts
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

// When YOUR user signs up, give them their own agent. `provision` is
// idempotent on externalId, so it's safe to call on every login.
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

Keys carry **scopes**: hand a narrower key to a subsystem that only needs part of the surface:

| Scope | Grants |
|-------|--------|
| `provision` | create agents |
| `deploy` | start/stop/restart/sleep/chat |
| `secrets` | read/write env vars |
| `manage` | everything, incl. delete + key management (wildcard) |

```ts
const worker = await maritime.keys.create({ name: 'chat-worker', scopes: ['deploy'] })
// worker.rawKey is shown once, so store it now.
```

Keys can also be **project-scoped**: the key to put in a partner-facing or
per-tenant service. A scoped key only works on the front door + usage
endpoints for that one project and is rejected everywhere else (other
projects 404), so a leak reaches one project's agents, not your whole account:

```ts
const runtime = await maritime.keys.create({
  name: 'poke-runtime',
  scopes: ['deploy', 'manage'],
  projectId: agent.projectId as string,
})
```

## Agents

```ts
// Create (kicks off deploy). Prefer `template`: a bare framework yields a broken image.
const agent = await maritime.agents.create({
  name: 'support-bot',
  template: 'openclaw',
  externalId: 'customer_42',
  instructions: 'You are a friendly support agent for Acme Inc.',
  env: [{ key: 'ACME_API_KEY', value: '...', secret: true }],
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

// Real-world identity (Identity add-on agents): phone, email, tunnel host.
// Channels never provisioned come back null; a fresh phone number reports
// smsStatus 'pending' during carrier warm-up.
const { phoneNumber, emailAddress } = await maritime.agents.identity(agent.id)

// Skills: list, search ClawHub, install, upload a custom skill, export.
// Install/upload auto-resolve missing binaries inside the agent's own VM
// and report the final state; `needs_input` means the skill just needs
// the listed env values (an API key, say) from your user.
const overview = await maritime.agents.skills.list(agent.id)
const result = await maritime.agents.skills.upload(agent.id, {
  archive: fs.readFileSync('daily-brief.zip'),   // zip or a bare SKILL.md
})
if (result.status === 'needs_input') {
  await maritime.agents.skills.setEnv(agent.id, { SOME_API_KEY: value })
}
const tarball = await maritime.agents.skills.export(agent.id, result.name)
await maritime.agents.skills.remove(agent.id, result.name)

// Files: browse the agent's persistent volume, move bytes both ways, and
// run one-shot commands. File operations wake a sleeping agent; transfers
// are capped at 100 MB per file.
const { root, entries } = await maritime.agents.files.list(agent.id)
await maritime.agents.files.upload(agent.id, {
  content: fs.readFileSync('report.csv'),
  filename: 'report.csv',
  destDir: `${root}/inbox`,        // omit destDir to deliver as a chat attachment
})
await maritime.agents.files.write(agent.id, `${root}/notes.md`, '# notes')
const bytes = await maritime.agents.files.download(agent.id, `${root}/notes.md`)
await maritime.agents.files.move(agent.id, `${root}/notes.md`, `${root}/docs/notes.md`)
await maritime.agents.files.delete(agent.id, `${root}/docs/notes.md`)
const { exitCode, stdout } = await maritime.agents.exec(agent.id, ['ls', '-la', root])
```

## Projects: one agent per end-user (the front door)

Route your end-users' messages through a project: each `externalUserId` gets a
sticky binding to its own agent (spawned from your template, warm-pool backed).
Full guide: [docs/FRONT_DOOR.md](../docs/FRONT_DOOR.md).

```ts
// One-time: routing policy on the agent's auto-created project
await maritime.projects.update(agent.projectId as string, {
  newChatPolicy: 'spawn',   // dedicated agent per end-user
  warmPoolSize: 3,          // new users bind in ~1s instead of a cold create
})

// Per message: get-or-create + wake + deliver
const msg = await maritime.projects.message(agent.projectId as string, {
  externalUserId: `user_${theirUserId}`,
  message: 'What does my dashboard say?',
  idempotencyKey: requestId,          // retries never double-deliver
})
if (msg.status === 'replied') console.log(msg.reply)
// 'provisioning' | 'queued' → reply arrives via the message.reply webhook,
// or poll: await maritime.projects.getMessage(projectId, msg.messageId)

// Your customer list
await maritime.projects.users(projectId)
await maritime.projects.unbindUser(projectId, 'user_42')
```

Subscribe to replies (and verify deliveries) with the webhook helper:

```ts
import { verifyWebhookSignature } from 'maritime-sdk'

const { secret } = await maritime.webhooks.create({
  url: 'https://api.acme.co/maritime/webhook',
  events: ['message.reply', 'message.failed'],
})

// in your handler, pass the RAW body:
const ok = await verifyWebhookSignature({ secret, body: rawBody, signature: sigHeader })
```


## Billing: rebill your users

Your plan is a flat monthly subscription that sets how many agents you may run,
so there is nothing metered by time to reconcile. What each agent spent on LLM
tokens out of your AI budget is per-agent and worth passing through:

```ts
// Per-agent / per-end-user cost over a date range (max 92 days), from the
// real money ledger. Rows carry externalUserId, so invoicing is a one-liner.
const report = await maritime.billing.usage({ from: '2026-07-01', to: '2026-08-01' })
for (const row of report.agents) invoice(row.externalUserId, row.totalCostCents)
```

Your own plan and invoices live at [maritime.sh/billing](https://maritime.sh/billing).

Creates that run past your plan's agent limit come back as
`MaritimePaymentRequiredError` (402). Its `.detail` is already the complete
sentence to show your user:

```ts
try {
  await maritime.agents.provision({ externalId: `customer_${user.id}`, name })
} catch (err) {
  if (err instanceof MaritimePaymentRequiredError) {
    // e.g. "You are on the free plan, which includes 3 agents (you have 3).
    //       Delete an agent you no longer need, or upgrade to a paid plan to
    //       create more: https://maritime.sh/billing"
    showBanner(err.detail)
  }
}
```

## Scheduled wakes (agent-side)

These helpers run INSIDE a Maritime agent (a BYO image speaking the
[contract](https://maritime.sh/docs)). A Maritime micro-VM sleeps at ~zero
cost between messages, so a plain `setInterval` never fires while it's
snapshotted; instead, publish your schedule and Maritime wakes the VM at the
right moments.

```ts
import { observeScheduler, pushSchedules } from 'maritime-sdk'

// One line: every add/remove on your scheduler re-publishes the snapshot.
observeScheduler(myScheduler, {
  getSnapshot: (s) => s.jobs.map(j => ({ id: j.id, nextRunAt: j.next.toISOString() })),
})

// Or push explicitly (send the FULL list; [] clears all synced wakes):
await pushSchedules([
  { id: 'digest', cron: '0 9 * * 1-5', tz: 'America/New_York', prompt: 'Send the digest' },
  { id: 'followup', nextRunAt: '2026-08-01T14:00:00Z' },
])
```

Entries use `nextRunAt` (the next occurrence as YOUR scheduler computed it)
or a 5-field `cron` + `tz`. An entry with `prompt` gets it delivered to your
`POST /chat` (source `"scheduled"`) right after the wake. Credentials come
from the env every Maritime agent already has; off-Maritime both helpers are
silent no-ops, so they're safe in local dev. Alternative with no SDK at all:
serve `GET /schedules` returning the same array and Maritime polls it.

## Errors

Every failure is a subclass of `MaritimeError`: catch the base to catch them all, or narrow by type:

```ts
import {
  MaritimeAuthError,           // 401 / 403: bad or under-scoped key
  MaritimePaymentRequiredError,// 402: plan limit reached (.detail says which)
  MaritimeNotFoundError,       // 404: no such agent (or not yours)
  MaritimeConflictError,       // 409: name already taken
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
