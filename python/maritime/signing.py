"""Webhook signature verification for Maritime deliveries."""

from __future__ import annotations

import hashlib
import hmac
from typing import Optional, Union


def verify_webhook_signature(
    secret: str,
    body: Union[bytes, str],
    signature: Optional[str],
) -> bool:
    """Verify a delivery's ``X-Maritime-Signature`` header (constant-time).

    Pass the RAW request body exactly as received — re-serializing parsed JSON
    will not match the signature.

    ::

        @app.post("/maritime/webhook")
        async def hook(request: Request):
            raw = await request.body()
            if not verify_webhook_signature(WEBHOOK_SECRET, raw,
                                            request.headers.get("X-Maritime-Signature")):
                return Response(status_code=401)
            event = json.loads(raw)
            if event["event"] == "message.reply":
                ...

    :param secret: the subscription's signing secret (``whsec_...``), returned
        once at create time.
    :param body: the raw request body.
    :param signature: the ``X-Maritime-Signature`` header (``sha256=<hex>``).
    """
    if not signature or not signature.startswith("sha256="):
        return False
    if isinstance(body, str):
        body = body.encode("utf-8")
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
