"""``client.computers``: persistent desktops driven by your own model.

Mirrors ``typescript/src/resources/computers.ts`` method for method.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from ._http import HttpClient
from .resources import _enc

_PREFIX = "/api/v1/computers"


class ComputerFiles:
    """Files on a computer's disk, under ``/data`` or ``/home/desk``.

    Reads and writes wake a sleeping computer but count as neither actions
    nor invocations. Transfers are capped at 8 MiB. Access via
    ``client.computers.files``.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def read(self, computer_id: str, path: str) -> bytes:
        """Read a file as raw bytes."""
        return self._http.request(
            "GET", f"{_PREFIX}/{_enc(computer_id)}/files", query={"path": path}, binary=True
        )

    def write(self, computer_id: str, path: str, data: Union[bytes, str]) -> None:
        """Write a file (creates or overwrites). ``str`` is sent as UTF-8."""
        raw = data.encode("utf-8") if isinstance(data, str) else bytes(data)
        self._http.request(
            "PUT",
            f"{_PREFIX}/{_enc(computer_id)}/files",
            query={"path": path},
            raw_body=raw,
            headers={"Content-Type": "application/octet-stream"},
        )

    def list(self, computer_id: str, path: str) -> Dict[str, Any]:
        """List a directory: ``{path, entries}``."""
        return self._http.request(
            "GET", f"{_PREFIX}/{_enc(computer_id)}/files/list", query={"path": path}
        )


class Computers:
    """One persistent Linux desktop per end user, driven by your own model
    through canonical actions. Access via ``client.computers``.

    Takes the same key as the rest of the API (``manage`` or full access). A
    key whose only scope is ``computers`` also works here and is refused
    everywhere else, so hand that one out when a leak should stay contained.

        computer = client.computers.create(external_user_id=user_id)
        shot = client.computers.act(computer["id"], {"action": "screenshot"})
        # ...show shot["imageB64"] (shot["width"] x shot["height"]) to your model...
        client.computers.act(computer["id"], {"action": "left_click", "coordinate": [640, 375]})
        client.computers.close_session(computer["id"])

    Every action wakes a sleeping computer and opens a session (one
    invocation) if none is open; :meth:`close_session` ends it. Coordinates
    are pixels of the last screenshot's reported ``width`` x ``height``.

    Actions are dicts in the canonical camelCase wire shape, passed through
    as-is (``scrollDirection``, ``scrollAmount``, ``startCoordinate``,
    ``noScreenshot``, ...). The 17 action names: ``screenshot``,
    ``left_click``, ``right_click``, ``middle_click``, ``double_click``,
    ``triple_click``, ``mouse_move``, ``left_click_drag``,
    ``left_mouse_down``, ``left_mouse_up``, ``scroll``, ``type``, ``key``,
    ``hold_key``, ``wait``, ``zoom``, ``cursor_position``.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.files = ComputerFiles(http)

    def create(
        self, *, external_user_id: Optional[str] = None, name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get-or-create a computer.

        With ``external_user_id`` the call is idempotent: the same id always
        returns the same computer. Without it a fresh anonymous computer is
        created on every call.
        """
        body: Dict[str, Any] = {}
        if external_user_id is not None:
            body["externalUserId"] = external_user_id
        if name is not None:
            body["name"] = name
        return self._http.request(
            "POST", _PREFIX, body=body, idempotent=external_user_id is not None
        )

    def list(self, *, external_user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List computers, optionally only the one bound to ``external_user_id``."""
        res = self._http.request("GET", _PREFIX, query={"externalUserId": external_user_id})
        return res["computers"]

    def get(self, computer_id: str) -> Dict[str, Any]:
        """Fetch one computer."""
        return self._http.request("GET", f"{_PREFIX}/{_enc(computer_id)}")

    def delete(self, computer_id: str) -> None:
        """Destroy the computer: its VM, snapshots and data volume."""
        self._http.request("DELETE", f"{_PREFIX}/{_enc(computer_id)}")

    def wake(self, computer_id: str) -> Dict[str, Any]:
        """Pre-warm a sleeping computer: ``{status, wakeMs, method}``.

        Idempotent; waking never opens a session. Raises
        :class:`~maritime.MaritimePaymentRequiredError` (402) when the plan
        blocks it.
        """
        return self._http.request(
            "POST", f"{_PREFIX}/{_enc(computer_id)}/wake", idempotent=True
        )

    def sleep(self, computer_id: str) -> Dict[str, Any]:
        """Close the open session and snapshot the computer to sleep."""
        return self._http.request(
            "POST", f"{_PREFIX}/{_enc(computer_id)}/sleep", idempotent=True
        )

    def act(
        self,
        computer_id: str,
        action: Union[Dict[str, Any], List[Dict[str, Any]]],
        *,
        format: Optional[str] = None,
        quality: Optional[int] = None,
    ) -> Any:
        """Run one canonical action (returns a result dict), or a list of
        actions in order (returns a list of results; the batch halts on the
        first failure).

        Each result carries ``frameId``, ``width``, ``height`` and, unless
        ``noScreenshot`` was set, ``imageB64``. ``format`` is ``png``
        (default) or ``jpeg``.

        Raises :class:`~maritime.MaritimeConflictError` (409) while a person
        holds the desktop, :class:`~maritime.MaritimePaymentRequiredError`
        (402) when a new session would exceed the plan, and
        :class:`~maritime.MaritimeRateLimitError` (429) at the concurrency cap.
        """
        extra: Dict[str, Any] = {}
        if format is not None:
            extra["format"] = format
        if quality is not None:
            extra["quality"] = quality
        path = f"{_PREFIX}/{_enc(computer_id)}/actions"
        if isinstance(action, list):
            res = self._http.request("POST", path, body={"actions": action, **extra})
            return res["results"]
        return self._http.request("POST", path, body={**action, **extra})

    def screenshot(
        self, computer_id: str, *, format: Optional[str] = None, quality: Optional[int] = None
    ) -> bytes:
        """Screenshot as raw image bytes (PNG by default).

        For the frame id and size alongside the image, use
        ``act(id, {"action": "screenshot"})``, which returns them as JSON.
        """
        return self._http.request(
            "GET",
            f"{_PREFIX}/{_enc(computer_id)}/screenshot",
            query={"format": format, "quality": quality},
            binary=True,
        )

    def exec(
        self, computer_id: str, command: str, *, timeout_s: Optional[int] = None
    ) -> Dict[str, Any]:
        """Run a shell command inside the computer: ``{exitCode, stdout, stderr}``.

        ``timeout_s`` is at most 30; omitted, the API default applies.
        """
        body: Dict[str, Any] = {"command": command}
        if timeout_s is not None:
            body["timeoutS"] = timeout_s
        return self._http.request("POST", f"{_PREFIX}/{_enc(computer_id)}/exec", body=body)

    def viewer(
        self,
        computer_id: str,
        *,
        mode: str = "watch",
        ttl_s: Optional[int] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Mint a viewer link: ``{url, expiresAt, mode}``.

        ``watch`` is read-only. ``control`` hands the desktop to a person (for
        logins, CAPTCHAs, payments) until they click Done or Failed; actions
        are refused with 409 meanwhile.
        """
        body: Dict[str, Any] = {"mode": mode}
        if ttl_s is not None:
            body["ttlS"] = ttl_s
        if reason is not None:
            body["reason"] = reason
        return self._http.request("POST", f"{_PREFIX}/{_enc(computer_id)}/viewer", body=body)

    def close_session(self, computer_id: str) -> Optional[Dict[str, Any]]:
        """End the open session (the invocation) now.

        The computer sleeps after a short grace; an action inside the grace
        reopens the same session at no charge. Returns ``None`` when no
        session was open.
        """
        return self._http.request(
            "POST", f"{_PREFIX}/{_enc(computer_id)}/sessions/close", idempotent=True
        )

    def sessions(self, computer_id: str) -> List[Dict[str, Any]]:
        """Sessions (invocations) on a computer, newest first."""
        res = self._http.request("GET", f"{_PREFIX}/{_enc(computer_id)}/sessions")
        return res["sessions"]

    def usage(
        self,
        *,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        external_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Invocations, seconds and actions per computer over a period."""
        return self._http.request(
            "GET",
            f"{_PREFIX}/usage",
            query={"from": from_, "to": to, "externalUserId": external_user_id},
        )
