"""The core loop: give every one of YOUR users their own Maritime agent when
they sign up.

`provision` is idempotent on external_id — it returns the existing agent if
there is one, otherwise creates a new one. Safe to call on every sign-in. The
agent boots in the background; talk to it when your user sends a message (see
fastapi_app.py).

    export MARITIME_API_KEY=mk_xxxxxxxxxxxx
    python provision_on_signup.py
"""
from maritime import Maritime

client = Maritime()  # reads MARITIME_API_KEY

# Pretend this is your user record.
user = {"id": "user_8842", "name": "Ada"}


def on_signup():
    agent = client.agents.provision(
        external_id=f"customer_{user['id']}",  # your id — how you find this agent later
        name=f"assistant-{user['id']}",
        template="openclaw",
        instructions=f"You are a friendly personal assistant for {user['name']}.",
    )
    print(f"provisioned agent {agent['id']} ({agent['status']}) for {user['name']}")

    # Find it again later by YOUR id — no need to store Maritime's id.
    found = client.agents.list(external_id=f"customer_{user['id']}")
    print("looked up by external_id:", found[0]["id"] if found else None)


if __name__ == "__main__":
    on_signup()
