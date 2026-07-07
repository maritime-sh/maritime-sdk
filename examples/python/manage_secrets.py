"""Give each customer's agent its own secrets (their API keys, tokens, config).
Secrets are encrypted at rest; changes reach a running agent after a reload.

    export MARITIME_API_KEY=mk_xxxxxxxxxxxx
    python manage_secrets.py
"""
from maritime import Maritime

client = Maritime()

agent = client.agents.provision(
    external_id="customer_42",
    name="assistant-42",
    template="openclaw",
)

# Store the customer's own credential on their agent (encrypted at rest).
client.agents.set_env(agent["id"], "ACME_API_KEY", "sk-the-customers-key", secret=True)

# Non-secret config is fine too.
client.agents.set_env(agent["id"], "ACME_REGION", "us-east", secret=False)

# Push the new env into the running container.
client.agents.reload_env(agent["id"])

# Read them back (secret values come back masked). The env endpoint is
# camelCase, so the field is "isSecret".
for v in client.agents.list_env(agent["id"]):
    tag = "  (secret)" if v.get("isSecret") else ""
    print(f"{v['key']} = {v['value']}{tag}")
