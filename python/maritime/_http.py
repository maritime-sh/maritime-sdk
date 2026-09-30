"""Zero-dependency HTTP transport (stdlib urllib) with typed errors + retry."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from .errors import MaritimeConnectionError, MaritimeError, api_error_from_status

DEFAULT_BASE_URL = "https://api.maritime.sh"
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class HttpClient:
    """Thin transport: auth header, JSON encode/decode, typed errors, bounded
    retry with backoff. No third-party dependencies."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        default_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        key = api_key or os.environ.get("MARITIME_API_KEY")
        if not key:
            raise MaritimeError(
                "Missing Maritime API key. Pass api_key=... or set MARITIME_API_KEY."
            )
        self._api_key = key
        self._base_url = (base_url or os.environ.get("MARITIME_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._default_headers = default_headers or {}

    def _url(self, path: str, query: Optional[Dict[str, Any]]) -> str:
        url = self._base_url + path
        if query:
            clean = {k: v for k, v in query.items() if v is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)
        return url

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Any] = None,
        idempotent: Optional[bool] = None,
        headers: Optional[Dict[str, str]] = None,
        binary: bool = False,
        raw_body: Optional[bytes] = None,
    ) -> Any:
        """``raw_body`` sends pre-encoded bytes as-is (multipart uploads);
        the caller supplies the matching Content-Type via ``headers``.
        Mutually exclusive with ``body``."""
        url = self._url(path, query)
        data = None
        req_headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": "maritime-python-sdk",
        }
        req_headers.update(self._default_headers)
        if headers:
            req_headers.update(headers)
        headers = req_headers
        if raw_body is not None:
            data = raw_body
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        method = method.upper()
        retry_safe = idempotent if idempotent is not None else method in ("GET", "DELETE")

        last_err: Optional[Exception] = None
        for attempt in range(self._max_retries + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    raw = resp.read()
                    if binary:
                        return raw
                    return self._parse(raw, resp.status)
            except urllib.error.HTTPError as e:
                status = e.code
                detail = self._detail(e)
                request_id = e.headers.get("x-request-id") if e.headers else None
                retryable = (
                    attempt < self._max_retries
                    and status in _RETRYABLE_STATUS
                    and (retry_safe or status in (429, 503))
                )
                if retryable:
                    last_err = api_error_from_status(status, detail, request_id)
                    time.sleep(self._backoff(attempt, e))
                    continue
                raise api_error_from_status(status, detail, request_id)
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last_err = e
                if attempt < self._max_retries:
                    time.sleep(self._backoff(attempt))
                    continue
                reason = getattr(e, "reason", e)
                raise MaritimeConnectionError(
                    f"Failed to reach Maritime at {self._base_url}: {reason}"
                ) from e

        if isinstance(last_err, MaritimeError):
            raise last_err
        raise MaritimeConnectionError(f"Request to {url} failed after retries")

    @staticmethod
    def _backoff(attempt: int, err: Optional[urllib.error.HTTPError] = None) -> float:
        if err is not None and err.headers:
            retry_after = err.headers.get("retry-after")
            if retry_after:
                try:
                    return min(float(retry_after), 20.0)
                except ValueError:
                    pass
        return min(0.5 * (2 ** attempt), 8.0)

    @staticmethod
    def _parse(raw: bytes, status: int) -> Any:
        if status == 204 or not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return raw.decode("utf-8", "replace")

    @staticmethod
    def _detail(err: urllib.error.HTTPError) -> str:
        try:
            payload = json.loads(err.read().decode("utf-8"))
            if isinstance(payload, dict) and "detail" in payload:
                d = payload["detail"]
                return d if isinstance(d, str) else json.dumps(d)
        except Exception:  # noqa: BLE001
            pass
        return f"Request failed with status {err.code}"
