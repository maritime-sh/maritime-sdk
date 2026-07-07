"""Receive Maritime lifecycle events + verify the HMAC-SHA256 signature.

Two parts:
  1. register a subscription once:  python flask_webhook.py register https://your-app.com/maritime/webhook
     (prints the signing secret — put it in MARITIME_WEBHOOK_SECRET)
  2. run the receiver:              MARITIME_WEBHOOK_SECRET=whsec_xxx flask --app flask_webhook run

    export MARITIME_API_KEY=mk_xxxxxxxxxxxx
    pip install -r requirements.txt
"""
import hashlib
import hmac
import os
import sys

from flask import Flask, request

from maritime import Maritime

# --- 1. one-time registration ---------------------------------------------
if len(sys.argv) > 1 and sys.argv[1] == "register":
    if len(sys.argv) < 3:
        sys.exit("usage: python flask_webhook.py register <https-url>")
    url = sys.argv[2]
    client = Maritime()
    hook = client.webhooks.create(url, events=["agent.deployed", "agent.error"])  # omit for all
    print("subscription:", hook["id"])
    print("signing secret (store as MARITIME_WEBHOOK_SECRET):", hook["secret"])
    client.webhooks.test(hook["id"])  # deliver a synthetic ping
    sys.exit(0)

# --- 2. the receiver -------------------------------------------------------
# Fail closed: never verify against an empty secret.
SECRET = os.environ.get("MARITIME_WEBHOOK_SECRET")
if not SECRET:
    raise RuntimeError("MARITIME_WEBHOOK_SECRET is required to verify signatures")

app = Flask(__name__)


@app.post("/maritime/webhook")
def receive():
    raw = request.get_data()  # exact bytes — the signature is computed over these
    expected = "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-Maritime-Signature", ""), expected):
        return "bad signature", 401

    event = request.get_json()
    # { "event": "agent.error", "agent_id": ..., "external_id": ..., "data": {...} }
    if event["event"] == "agent.error":
        print(f"agent for {event['external_id']} errored — notify the customer")
    elif event["event"] == "agent.deployed":
        print(f"agent for {event['external_id']} is ready")
    else:
        print("event:", event["event"], "for", event["external_id"])
    return "ok", 200
