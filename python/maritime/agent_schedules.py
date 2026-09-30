"""Agent-side schedule observation (runs INSIDE a Maritime agent).

A Maritime agent sleeps at ~zero cost between events; anything on a
timeline needs Maritime to wake the VM. Your agent keeps its own
scheduler; these helpers push a read-only projection of it so Maritime
becomes the durable alarm clock.

Two ways in (either is enough):

1. Serve ``GET /schedules`` on your agent's HTTP server returning the
   same entry shape. Maritime polls it while you're awake; no SDK.
2. Call :func:`push_schedules` (or wire :func:`observe_scheduler`)
   whenever your schedule changes: zero-latency sync that survives a
   crash before Maritime's next poll.

Entry shape (dict per schedule)::

    {"id": "morning",                      # required, stable
     "nextRunAt": "2026-07-24T09:35:00Z",  # preferred: YOUR computed next run
     "cron": "35 9 * * *", "tz": "America/New_York",  # alternative
     "prompt": "Send the morning summary", # optional: delivered on wake
     "name": "Morning summary",            # optional display name
     "enabled": True}

Credentials come from the env every Maritime agent already has
(``MARITIME_BACKEND_URL``, ``MARITIME_AGENT_ID``,
``MARITIME_INTERNAL_TOKEN``). Off-Maritime they're absent and every
helper is a silent no-op, so the calls are safe in local development.
Zero dependencies (stdlib urllib), matching the rest of this SDK.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence

_DEFAULT_MUTATORS = (
    "add", "remove", "update", "cancel", "delete",
    "schedule", "unschedule", "pause", "resume",
)


def _resolve_env(
    backend_url: Optional[str], agent_id: Optional[str], token: Optional[str]
) -> Optional[Dict[str, str]]:
    backend_url = backend_url or os.environ.get("MARITIME_BACKEND_URL")
    agent_id = agent_id or os.environ.get("MARITIME_AGENT_ID")
    token = token or os.environ.get("MARITIME_INTERNAL_TOKEN")
    if not backend_url or not agent_id or not token:
        return None
    return {
        "backend_url": backend_url.rstrip("/"),
        "agent_id": agent_id,
        "token": token,
    }


def push_schedules(
    schedules: List[Dict[str, Any]],
    *,
    backend_url: Optional[str] = None,
    agent_id: Optional[str] = None,
    token: Optional[str] = None,
    timeout: float = 10.0,
) -> bool:
    """Push the FULL current schedule list to Maritime.

    Send the complete list every time: Maritime adds, updates, and
    removes wake triggers to match it, so ``[]`` clears all synced
    wakes. Returns True when accepted; False when skipped (not on
    Maritime) or rejected. Never raises.
    """
    creds = _resolve_env(backend_url, agent_id, token)
    if creds is None:
        return False
    req = urllib.request.Request(
        f"{creds['backend_url']}/api/agents/internal/schedules",
        data=json.dumps({"schedules": schedules}).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Maritime-Agent-Id": creds["agent_id"],
            "Authorization": f"Bearer {creds['token']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError, ValueError):
        return False


def observe_scheduler(
    scheduler: Any,
    *,
    get_snapshot: Optional[Callable[[Any], List[Dict[str, Any]]]] = None,
    methods: Sequence[str] = _DEFAULT_MUTATORS,
    debounce_s: float = 0.5,
    backend_url: Optional[str] = None,
    agent_id: Optional[str] = None,
    token: Optional[str] = None,
) -> Callable[[], bool]:
    """One-line Tier C wrap: instruments the scheduler's mutator methods
    so every add/remove/update pushes a fresh snapshot to Maritime
    moments later. Your scheduling logic is untouched (OTel-style).

    ``get_snapshot(scheduler)`` must return the current entry list;
    defaults to calling ``scheduler.get_schedules()`` or
    ``scheduler.list()``. Returns a ``push()`` callable you can also
    invoke manually (e.g. once at boot).

    Example::

        from maritime import observe_scheduler
        push = observe_scheduler(
            my_scheduler,
            get_snapshot=lambda s: [
                {"id": j.id, "nextRunAt": j.next_run.isoformat()}
                for j in s.jobs()
            ],
        )
        push()  # initial sync
    """
    def _default_snapshot(s: Any) -> List[Dict[str, Any]]:
        for attr in ("get_schedules", "list"):
            fn = getattr(s, attr, None)
            if callable(fn):
                out = fn()
                return list(out) if out else []
        return []

    snapshot_fn = get_snapshot or _default_snapshot

    def push() -> bool:
        try:
            snapshot = snapshot_fn(scheduler)
        except Exception:
            return False
        return push_schedules(
            list(snapshot or []),
            backend_url=backend_url, agent_id=agent_id, token=token,
        )

    timer_ref: Dict[str, Optional[threading.Timer]] = {"t": None}

    def _schedule_push() -> None:
        t = timer_ref["t"]
        if t is not None:
            t.cancel()
        nt = threading.Timer(debounce_s, push)
        nt.daemon = True  # never keep the process alive for a pending sync
        timer_ref["t"] = nt
        nt.start()

    for name in methods:
        original = getattr(scheduler, name, None)
        if not callable(original):
            continue

        def _wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
            def wrapper(*args: Any, **kw: Any) -> Any:
                result = fn(*args, **kw)
                _schedule_push()
                return result
            wrapper.__name__ = getattr(fn, "__name__", "wrapped")
            return wrapper

        setattr(scheduler, name, _wrap(original))

    return push
