"""Mint a narrowly-scoped key for a subsystem that only needs part of the API.

A background worker that only chats to existing agents needs `deploy` — not
`provision`, `secrets`, or `manage`. If that key leaks, the blast radius is
limited to what `deploy` allows.

The key you run THIS with must itself carry `manage` (minting keys is gated).

    export MARITIME_API_KEY=mk_your_full_key
    python scoped_key.py
"""
from maritime import Maritime

client = Maritime()

worker = client.keys.create(
    "chat-worker",
    scopes=["deploy"],  # chat/start/stop only — cannot create, delete, or read secrets
)

# The Python SDK returns the raw API JSON (this endpoint is snake_case).
print("worker key (shown once — store it now):", worker["raw_key"])
print("scopes:", worker["scopes"])

# Hand worker["raw_key"] to your worker process as its MARITIME_API_KEY.
