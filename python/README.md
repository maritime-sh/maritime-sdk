# maritime (Python SDK)

Official Python SDK for [Maritime](https://maritime.sh): provision and drive AI agents on Maritime's serverless infrastructure, straight from your own backend.

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
# on external_id, so it's safe to call on every login.
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

Keys carry **scopes**: hand a narrower key to a subsystem that only needs part of the surface:

| Scope | Grants |
|-------|--------|
| `provision` | create agents |
| `deploy` | start/stop/restart/sleep/chat |
| `secrets` | read/write env vars |
| `manage` | everything, incl. delete + key management (wildcard) |

```python
worker = client.keys.create("chat-worker", scopes=["deploy"])
# worker["raw_key"] is shown once, so store it now.
```

Keys can also be **project-scoped**: the key to put in a partner-facing or
per-tenant service. A scoped key only works on the front door + usage
endpoints for that one project and is rejected everywhere else (other
projects 404), so a leak means "message your own fleet", not your wallet:

```python
runtime = client.keys.create("poke-runtime", scopes=["deploy", "manage"],
                             project_id=agent["projectId"])
```

## Agents

```python
# Create (kicks off deploy). Prefer template: a bare framework yields a broken image.
agent = client.agents.create(
    "support-bot",
    template="openclaw",
    external_id="customer_42",
    instructions="You are a friendly support agent for Acme Inc.",
    env=[{"key": "ACME_API_KEY", "value": "...", "secret": True}],
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

# Real-world identity (Identity add-on agents): phone, email, tunnel host.
# Channels never provisioned come back None; a fresh phone number reports
# smsStatus "pending" during carrier warm-up.
identity = client.agents.identity(agent["id"])
identity["phoneNumber"], identity["emailAddress"]

# Skills: list, search ClawHub, install, upload a custom skill, export.
# Install/upload auto-resolve missing binaries inside the agent's own VM
# and report the final state; "needs_input" means the skill just needs
# the listed env values (an API key, say) from your user.
overview = client.agents.skills.list(agent["id"])
result = client.agents.skills.upload(agent["id"], open("daily-brief.zip", "rb").read())
if result["status"] == "needs_input":
    client.agents.skills.set_env(agent["id"], {"SOME_API_KEY": value})
tarball = client.agents.skills.export(agent["id"], result["name"])
client.agents.skills.remove(agent["id"], result["name"])

# Files: browse the agent's persistent volume, move bytes both ways, and
# run one-shot commands. File operations wake a sleeping agent; transfers
# are capped at 100 MB per file.
listing = client.agents.files.list(agent["id"])          # {path, root, entries}
root = listing["root"]                                   # /data for most frameworks
client.agents.files.upload(
    agent["id"], open("report.csv", "rb").read(), "report.csv",
    dest_dir=f"{root}/inbox",     # omit dest_dir to deliver as a chat attachment
)
client.agents.files.write(agent["id"], f"{root}/notes.md", "# notes")
data = client.agents.files.download(agent["id"], f"{root}/notes.md")
client.agents.files.move(agent["id"], f"{root}/notes.md", f"{root}/docs/notes.md")
client.agents.files.delete(agent["id"], f"{root}/docs/notes.md")
result = client.agents.exec(agent["id"], ["ls", "-la", root])
result["exitCode"], result["stdout"]
```

## Projects: one agent per end-user (the front door)

Route your end-users' messages through a project: each ``external_user_id``
gets a sticky binding to its own agent (spawned from your template, warm-pool
backed). Full guide: [docs/FRONT_DOOR.md](../docs/FRONT_DOOR.md).

```python
# One-time: fleet policy on the agent's auto-created project
client.projects.update(agent["projectId"],
                       new_chat_policy="spawn",  # dedicated agent per end-user
                       warm_pool_size=3)         # new users bind in ~1s

# Per message: get-or-create + wake + deliver
msg = client.projects.message(agent["projectId"],
                              external_user_id=f"user_{uid}",
                              message="What does my dashboard say?",
                              idempotency_key=request_id)
if msg["status"] == "replied":
    print(msg["reply"])
# "provisioning" | "queued" -> reply arrives via the message.reply webhook,
# or poll: client.projects.get_message(project_id, msg["messageId"])

# Your customer list
client.projects.users(project_id)
client.projects.unbind_user(project_id, "user_42")
```

Subscribe to replies (and verify deliveries) with the webhook helper:

```python
from maritime import verify_webhook_signature

hook = client.webhooks.create("https://api.acme.co/maritime/webhook",
                              events=["message.reply", "message.failed"])
# in your handler -- pass the RAW body:
ok = verify_webhook_signature(hook["secret"], raw_body, sig_header)
```


## Billing: rebill your users

Every account created after July 2026 is on a plan: a flat subscription that
includes a number of machines, where a machine is one micro-VM. An agent is a
machine and a Computer is a machine, so one plan covers both and nothing is
metered per action or per session. The usage report below works on any
account. `set_auto_recharge` applies only to the grandfathered wallet model,
which no new account uses.

```python
# Per-agent / per-end-user cost over a date range (max 92 days), from the
# real money ledger. Rows carry externalUserId, so invoicing is a one-liner.
report = client.billing.usage(from_="2026-07-01", to="2026-08-01")
for row in report["agents"]:
    invoice(row["externalUserId"], row["totalCostCents"])

# Auto-recharge (wallet accounts only): below threshold_cents, Maritime
# charges your saved card for amount_cents (max 3x/24h, 6h backoff after a
# failure). Kills the "wallet hits zero and everything sleeps" cliff.
client.billing.set_auto_recharge(enabled=True, threshold_cents=2000, amount_cents=10000)

# Per-end-user compute caps: stamped on every NEW instance the project
# spawns; over-cap instances auto-sleep instead of running up a bill.
client.projects.update(project_id, instance_compute_minutes_limit=300)
```

## Scheduled wakes (agent-side)

These helpers run INSIDE a Maritime agent (a BYO image speaking the
contract). A Maritime micro-VM sleeps at ~zero cost between messages, so a
plain timer thread never fires while it's snapshotted; instead, publish your
schedule and Maritime wakes the VM at the right moments.

```python
from maritime import observe_scheduler, push_schedules

# One line: every add/remove on your scheduler re-publishes the snapshot.
observe_scheduler(
    my_scheduler,
    get_snapshot=lambda s: [
        {"id": j.id, "nextRunAt": j.next_run.isoformat()} for j in s.jobs()
    ],
)

# Or push explicitly (send the FULL list; [] clears all synced wakes):
push_schedules([
    {"id": "digest", "cron": "0 9 * * 1-5", "tz": "America/New_York",
     "prompt": "Send the digest"},
    {"id": "followup", "nextRunAt": "2026-08-01T14:00:00Z"},
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

```python
from maritime import (
    MaritimeAuthError,            # 401 / 403: bad or under-scoped key
    MaritimePaymentRequiredError, # 402: plan limit reached or wallet needs funding
    MaritimeNotFoundError,        # 404: no such agent (or not yours)
    MaritimeConflictError,        # 409: name already taken
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
