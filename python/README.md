# maritime (Python SDK)

Official Python SDK for [Maritime](https://maritime.sh) — provision and drive AI agents on Maritime's serverless infrastructure, straight from your own backend.

Build an app where every one of **your** users gets **their own** agent: one call on sign-up spins up an isolated agent on Maritime's fleet; another sends it a message. You never touch a container.

```bash
pip install maritime
```

Python 3.9+. Zero dependencies (pure standard library).

## Quick start

```python
from maritime import Maritime

client = Maritime()  # reads MARITIME_API_KEY

# When YOUR user signs up, give them their own agent. provision() is idempotent
# on external_id — safe to call on every login.
agent = client.agents.provision(
    external_id=f"customer_{user.id}",   # your id for this agent
    name=f"assistant-{user.id}",
    template="openclaw",
)

# Talk to it (sleeping agents auto-wake):
reply = client.agents.chat(agent["id"], "Summarize my unread email.")["response"]
print(reply)
```

## Authentication

Mint an API key (`mk_...`) from the dashboard (**Settings → API keys**) or the CLI (`maritime keys create`), then set `MARITIME_API_KEY`, or pass it explicitly:

```python
client = Maritime(api_key="mk_...")
```

Keys carry **scopes** — hand a narrower key to a subsystem that only needs part of the surface:

| Scope | Grants |
|-------|--------|
| `provision` | create agents |
| `deploy` | start/stop/restart/sleep/chat |
| `secrets` | read/write env vars |
| `manage` | everything, incl. delete + key management (wildcard) |

```python
worker = client.keys.create("chat-worker", scopes=["deploy"])
# worker["raw_key"] is shown once — store it now.
```

## Agents

```python
# Create (kicks off deploy). Prefer template — a bare framework yields a broken image.
agent = client.agents.create(
    "support-bot",
    template="openclaw",
    external_id="customer_42",
    instructions="You are a friendly support agent for Acme Inc.",
    env=[{"key": "ACME_API_KEY", "value": "...", "secret": True}],
    tier="smart",            # "smart" | "extended" | "always_on"
    idle_ttl_seconds=3600,   # 0 = always-on
)

# Idempotent get-or-create by external_id (recommended for per-user provisioning)
agent = client.agents.provision(external_id="customer_42", name="support-bot")

client.agents.get(agent["id"])
client.agents.list(external_id="customer_42")   # filter by your id
client.agents.list()                             # all of your agents

# Chat (synchronous; auto-wakes a sleeping agent)
result = client.agents.chat(agent["id"], "Hello")
print(result["response"])   # None + result["error"] if delivery failed

# Lifecycle
client.agents.start(agent["id"])
client.agents.sleep(agent["id"])     # cheapest resting state (serverless snapshot)
client.agents.restart(agent["id"])
client.agents.delete(agent["id"])    # tears down container + volume + network

# Env vars (secrets encrypted at rest; reach a running container after reload_env)
client.agents.set_env(agent["id"], "STRIPE_KEY", "sk_live_...", secret=True)
client.agents.list_env(agent["id"])
client.agents.reload_env(agent["id"])

# Logs
client.agents.logs(agent["id"], limit=100, level="error")
```

## Errors

Every failure is a subclass of `MaritimeError` — catch the base to catch them all, or narrow by type:

```python
from maritime import (
    MaritimeAuthError,            # 401 / 403 — bad or under-scoped key
    MaritimePaymentRequiredError, # 402 — wallet needs funding
    MaritimeNotFoundError,        # 404 — no such agent (or not yours)
    MaritimeConflictError,        # 409 — name already taken
    MaritimeRateLimitError,       # 429
    MaritimeAPIError,             # any other non-2xx (has .status, .detail)
    MaritimeConnectionError,      # never reached Maritime (network/timeout)
)

try:
    client.agents.create("dupe", template="openclaw")
except MaritimeConflictError:
    ...  # an agent with that name already exists
except MaritimeAPIError as err:
    print(err.status, err.detail, err.request_id)
```

## Configuration

```python
Maritime(
    api_key="mk_...",                    # or MARITIME_API_KEY
    base_url="https://api.maritime.sh",  # or MARITIME_API_URL
    timeout=60.0,                        # per-request seconds
    max_retries=2,                       # network + 5xx/429 (GET/DELETE and 429/503 only)
    default_headers={"x-team": "acme"},
)
```

Retries are safe by construction: `GET`/`DELETE` retry on any transient failure; `POST`/`PUT` retry only on network errors and `429`/`503` (never a `5xx` that might have applied a write).

## License

MIT
