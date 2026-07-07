# Maritime SDK examples

Runnable examples for [`maritime-sdk`](../typescript) (TypeScript) and [`maritime`](../python) (Python).
Every example is a real, self-contained file — copy one, set `MARITIME_API_KEY`, and run.

Get an API key from the dashboard (**Settings → API keys**) or the CLI (`maritime keys create`), then:

```bash
export MARITIME_API_KEY=mk_xxxxxxxxxxxx
```

## TypeScript ([`examples/typescript`](typescript))

| File | What it shows |
|---|---|
| [`provision-on-signup.ts`](typescript/provision-on-signup.ts) | The core loop — give every one of your users their own agent (idempotent) |
| [`express-chat-api.ts`](typescript/express-chat-api.ts) | An Express endpoint that provisions + chats with the caller's agent |
| [`nextjs-route.ts`](typescript/nextjs-route.ts) | A Next.js App Router route handler |
| [`webhook-receiver.ts`](typescript/webhook-receiver.ts) | Receive lifecycle events + verify the HMAC signature |
| [`scoped-key.ts`](typescript/scoped-key.ts) | Mint a narrowly-scoped key for a background worker |
| [`manage-secrets.ts`](typescript/manage-secrets.ts) | Set per-customer secrets and hot-reload them |

```bash
cd typescript && npm install
npx tsx provision-on-signup.ts
```

## Python ([`examples/python`](python))

| File | What it shows |
|---|---|
| [`provision_on_signup.py`](python/provision_on_signup.py) | The core loop — one agent per customer (idempotent) |
| [`fastapi_app.py`](python/fastapi_app.py) | A FastAPI app with signup + chat endpoints |
| [`flask_webhook.py`](python/flask_webhook.py) | A Flask receiver that verifies the HMAC signature |
| [`scoped_key.py`](python/scoped_key.py) | Mint a narrowly-scoped key for a worker |
| [`manage_secrets.py`](python/manage_secrets.py) | Set per-customer secrets and hot-reload them |

```bash
cd python && pip install -r requirements.txt
python provision_on_signup.py
```

## Scopes

Hand a subsystem the narrowest key it needs — a leaked key can then only do what its scope allows.

| Scope | Grants |
|---|---|
| `provision` | create agents |
| `deploy` | start / stop / restart / sleep / chat |
| `secrets` | read / write env vars |
| `manage` | everything, incl. delete + key management (wildcard) |

Full guide: **https://maritime.sh/docs/build**
