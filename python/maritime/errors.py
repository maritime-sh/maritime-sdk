"""Exception hierarchy for the Maritime SDK.

Catch :class:`MaritimeError` to catch them all, or narrow by subclass.
"""

from __future__ import annotations

from typing import Optional


class MaritimeError(Exception):
    """Base class for every error the SDK raises."""


class MaritimeConnectionError(MaritimeError):
    """The request never reached Maritime (DNS, connection, timeout)."""


class MaritimeAPIError(MaritimeError):
    """Maritime returned a non-2xx response."""

    def __init__(self, status: int, detail: str, request_id: Optional[str] = None) -> None:
        super().__init__(f"Maritime API error {status}: {detail}")
        self.status = status
        self.detail = detail
        self.request_id = request_id


class MaritimeAuthError(MaritimeAPIError):
    """401 / 403 — bad or insufficiently-scoped API key."""


class MaritimePaymentRequiredError(MaritimeAPIError):
    """402 — the account wallet needs funding before this action can proceed."""


class MaritimeNotFoundError(MaritimeAPIError):
    """404 — the agent (or other resource) does not exist or is not yours."""


class MaritimeConflictError(MaritimeAPIError):
    """409 — a uniqueness conflict (e.g. an agent name already exists)."""


class MaritimeRateLimitError(MaritimeAPIError):
    """429 — rate limited."""


def api_error_from_status(status: int, detail: str, request_id: Optional[str] = None) -> MaritimeAPIError:
    """Build the most specific error subclass for an HTTP status."""
    if status in (401, 403):
        return MaritimeAuthError(status, detail, request_id)
    if status == 402:
        return MaritimePaymentRequiredError(status, detail, request_id)
    if status == 404:
        return MaritimeNotFoundError(status, detail, request_id)
    if status == 409:
        return MaritimeConflictError(status, detail, request_id)
    if status == 429:
        return MaritimeRateLimitError(status, detail, request_id)
    return MaritimeAPIError(status, detail, request_id)
