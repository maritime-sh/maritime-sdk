"""Official Python SDK for Maritime.

Provision and drive AI agents on Maritime's serverless infrastructure from your
own backend.

    from maritime import Maritime

    client = Maritime()  # reads MARITIME_API_KEY

    # When YOUR user signs up, give them their own agent (idempotent):
    agent = client.agents.provision(
        external_id=f"customer_{user_id}",
        name=f"assistant-{user_id}",
        template="openclaw",
    )
    reply = client.agents.chat(agent["id"], "Hello!")["response"]
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ._http import HttpClient
from .errors import (
    MaritimeAPIError,
    MaritimeAuthError,
    MaritimeConflictError,
    MaritimeConnectionError,
    MaritimeError,
    MaritimeNotFoundError,
    MaritimePaymentRequiredError,
    MaritimeRateLimitError,
)
from .resources import Agents, Billing, Keys, Projects, Webhooks
from .signing import verify_webhook_signature
from .agent_schedules import observe_scheduler, push_schedules

__version__ = "0.6.0"

__all__ = [
    "observe_scheduler",
    "push_schedules",
    "Maritime",
    "verify_webhook_signature",
    "MaritimeError",
    "MaritimeConnectionError",
    "MaritimeAPIError",
    "MaritimeAuthError",
    "MaritimePaymentRequiredError",
    "MaritimeNotFoundError",
    "MaritimeConflictError",
    "MaritimeRateLimitError",
]


class Maritime:
    """The Maritime client.

    :param api_key: ``mk_...`` key. Defaults to the ``MARITIME_API_KEY`` env var.
    :param base_url: API base. Defaults to ``MARITIME_API_URL`` or api.maritime.sh.
    :param timeout: per-request timeout (seconds).
    :param max_retries: retries on network errors and 5xx/429.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        default_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self.http = HttpClient(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=default_headers,
        )
        self.agents = Agents(self.http)
        self.billing = Billing(self.http)
        self.keys = Keys(self.http)
        self.projects = Projects(self.http)
        self.webhooks = Webhooks(self.http)

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Escape hatch for endpoints not yet wrapped."""
        return self.http.request(method, path, **kwargs)
