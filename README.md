# Maritime SDKs

Official SDKs for [Maritime](https://maritime.sh) — provision and drive AI agents on Maritime's serverless infrastructure from your own backend.

Build an app where every one of **your** users gets **their own** agent: one call on sign-up spins up an isolated agent on Maritime's fleet; another sends it a message. You never touch a container.

| Language | Package | Install | Source |
|---|---|---|---|
| TypeScript / JavaScript | [`maritime-sdk`](https://www.npmjs.com/package/maritime-sdk) | `npm install maritime-sdk` | [`typescript/`](typescript/) |
| Python | `maritime` (PyPI) | `pip install maritime` | [`python/`](python/) |

## Quick start (TypeScript)

```ts
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

// When YOUR user signs up — idempotent get-or-create by your own id:
const agent = await maritime.agents.provision({
  externalId: `customer_${user.id}`,
  name: `assistant-${user.id}`,
  template: 'openclaw',
})

const { response } = await maritime.agents.chat(agent.id, 'Hello!')
```

## Quick start (Python)

```python
from maritime import Maritime

client = Maritime()  # reads MARITIME_API_KEY

agent = client.agents.provision(
    external_id=f"customer_{user_id}",
    name=f"assistant-{user_id}",
    template="openclaw",
)
reply = client.agents.chat(agent["id"], "Hello!")["response"]
```

## Examples

Runnable, copy-paste examples for both languages live in [`examples/`](examples) — provision-on-signup, Express / FastAPI / Next.js chat APIs, a webhook receiver with signature verification, scoped keys, and per-customer secrets. Every one is verified to compile against the published packages.

## Docs

- Guide: <https://maritime.sh/docs/build>
- REST API reference: <https://maritime.sh/docs/api>
- Mint an API key: dashboard → Settings → API keys, or `maritime keys create` ([CLI](https://www.npmjs.com/package/maritime-cli))

Both SDKs are zero-dependency, cover agents (create / provision / chat / lifecycle / env / logs), API keys with scopes, and outbound webhooks (HMAC-signed agent lifecycle events).

## License

MIT
