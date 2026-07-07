"""The core loop: give every one of YOUR users their own Maritime agent.

`provision` is idempotent on external_id — it returns the existing agent if
there is one, otherwise creates a new one. Safe to call on every sign-in.

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
    print(f"agent {agent['id']} is {agent['status']} for {user['name']}")

    # Talk to it. Sleeping agents wake automatically; the call waits for the reply.
    # chat() returns {"response", "error"?} — a delivery failure lands in "error"
    # rather than raising, so check it.
    result = client.agents.chat(agent["id"], "Say hi to your new user in one line.")
    if result.get("error"):
        raise RuntimeError(f"chat failed: {result['error']}")
    print("agent says:", result["response"])

    # Find it again later by YOUR id — no need to store Maritime's id.
    found = client.agents.list(external_id=f"customer_{user['id']}")
    print("looked up by external_id:", found[0]["id"] if found else None)


if __name__ == "__main__":
    on_signup()
