"""Resource namespaces: ``client.agents`` and ``client.keys``."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._http import HttpClient


class AgentSkills:
    """Skill management on an agent: list what's available, install from
    ClawHub / git / an uploaded archive, and remove or export custom skills.

    Install and upload run the "just works" pipeline server-side: missing
    binaries are auto-resolved inside the agent's own VM (nix catalog ->
    npm -> pip -> apt, replayed on boot), and the result reports the final
    state: ``active`` (usable now), ``needs_input`` (``missing["env"]`` /
    ``missing["config"]`` need values; pass them to :meth:`set_env` or the
    ``env=`` kwarg), or ``failed``.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, agent_id: str) -> Dict[str, Any]:
        """The agent's full skill registry: eligible / blocked / unsupported."""
        return self._http.request("GET", f"/api/agents/{_enc(agent_id)}/skills")

    def search(self, agent_id: str, q: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Search ClawHub (OpenClaw's public skill marketplace)."""
        res = self._http.request(
            "GET", f"/api/agents/{_enc(agent_id)}/skills/search", query={"q": q, "limit": limit}
        )
        return (res or {}).get("results") or []

    def install(
        self,
        agent_id: str,
        *,
        slug: Optional[str] = None,
        git: Optional[str] = None,
        version: Optional[str] = None,
        force: bool = False,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Install from ClawHub (``slug=``) or a git repo (``git=``)."""
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/skills/install",
            body={"slug": slug, "git": git, "version": version, "force": force, "env": env},
        )

    def upload(
        self,
        agent_id: str,
        archive: "bytes | str",
        *,
        name: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Install a CUSTOM skill from a zip or bare SKILL.md (bytes, or an
        already-base64-encoded string)."""
        import base64 as _b64

        encoded = archive if isinstance(archive, str) else _b64.b64encode(archive).decode()
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/skills/upload",
            body={"archiveBase64": encoded, "name": name, "env": env},
        )

    def set_env(self, agent_id: str, env: Dict[str, str]) -> Dict[str, Any]:
        """Provide env values a ``needs_input`` skill is waiting on."""
        return self._http.request(
            "PUT", f"/api/agents/{_enc(agent_id)}/skills/env", body={"env": env}
        )

    def set_allowlist(self, agent_id: str, allowlist: Optional[List[str]]) -> Dict[str, Any]:
        """Replace the per-agent allowlist. ``None`` = unrestricted."""
        return self._http.request(
            "PUT", f"/api/agents/{_enc(agent_id)}/skills/allowlist", body={"allowlist": allowlist}
        )

    def remove(self, agent_id: str, name: str) -> None:
        """Remove an installed (custom or hub) skill from the agent."""
        self._http.request("DELETE", f"/api/agents/{_enc(agent_id)}/skills/{_enc(name)}")

    def export(self, agent_id: str, name: str) -> bytes:
        """Download a skill as .tar.gz bytes (the mirror of :meth:`upload`)."""
        return self._http.request(
            "GET", f"/api/agents/{_enc(agent_id)}/skills/{_enc(name)}/export", binary=True
        )


class AgentFiles:
    """Files on an agent's disk: browse, download, upload, edit, organize.
    Access via ``client.agents.files``.

    Browse/mutate operations are scoped to the agent's persistent volume
    (the ``root`` reported by :meth:`list`; framework-dependent: ``/data``
    for most, ``/zeroclaw-data`` for zeroclaw, ``/opt/data`` for hermes).
    Download may read any absolute in-container path, since agents produce
    files in /tmp and workspace directories too. Any file operation wakes a
    sleeping serverless agent. Transfers are capped at 100 MB per file.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, agent_id: str, path: Optional[str] = None) -> Dict[str, Any]:
        """List a volume directory: ``{path, root, entries}``. ``path``
        defaults to the volume root."""
        return self._http.request(
            "GET", f"/api/agents/{_enc(agent_id)}/files/list", query={"path": path}
        )

    def download(self, agent_id: str, path: str) -> bytes:
        """Download a file (any absolute in-container path) as raw bytes."""
        return self._http.request(
            "GET",
            f"/api/agents/{_enc(agent_id)}/files/download",
            query={"path": path},
            binary=True,
        )

    def upload(
        self,
        agent_id: str,
        content: bytes | str,
        filename: str,
        *,
        dest_dir: Optional[str] = None,
        message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Push a file into the agent's container.

        With ``dest_dir``, the file is placed in that exact volume directory
        keeping ``filename`` as-is; without it, it's delivered as a chat
        attachment (framework inbox under a timestamped name plus a notice in
        the agent's conversation; ``message`` rides along). Returns the
        in-container path the file landed at.
        """
        payload = content.encode("utf-8") if isinstance(content, str) else content
        fields = {}
        if dest_dir is not None:
            fields["dest_dir"] = dest_dir
        if message is not None:
            fields["message"] = message
        raw, content_type = _multipart(fields, "file", filename, payload)
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/files/upload",
            raw_body=raw,
            headers={"Content-Type": content_type},
        )

    def write(self, agent_id: str, path: str, content: str) -> None:
        """Write a UTF-8 text file in the volume (creates or overwrites)."""
        self._http.request(
            "PUT",
            f"/api/agents/{_enc(agent_id)}/files/write",
            body={"path": path, "content": content},
        )

    def mkdir(self, agent_id: str, path: str) -> None:
        """Create a directory (``mkdir -p``) in the volume."""
        self._http.request(
            "POST", f"/api/agents/{_enc(agent_id)}/files/mkdir", body={"path": path}
        )

    def move(self, agent_id: str, from_path: str, to_path: str) -> None:
        """Move or rename within the volume; missing parents of the
        destination are created. Raises :class:`MaritimeConflictError` (409)
        if the destination already exists and :class:`MaritimeNotFoundError`
        (404) if the source doesn't."""
        self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/files/move",
            body={"from": from_path, "to": to_path},
        )

    def delete(self, agent_id: str, path: str) -> None:
        """Delete a file or directory (recursive). 404 if it doesn't exist."""
        self._http.request(
            "DELETE", f"/api/agents/{_enc(agent_id)}/files/delete", query={"path": path}
        )


class Agents:
    """Operations on Maritime agents. Access via ``client.agents``."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        #: Skill management: list / search / install / upload / remove / export.
        self.skills = AgentSkills(http)
        #: Files on the agent's disk: browse / download / upload / edit / organize.
        self.files = AgentFiles(http)

    def create(
        self,
        name: str,
        *,
        template: Optional[str] = None,
        external_id: Optional[str] = None,
        description: Optional[str] = None,
        instructions: Optional[str] = None,
        # Deprecated: tiers are retired; any value is ignored server-side.
        tier: Optional[str] = None,
        env: Optional[List[Dict[str, Any]]] = None,
        mem_mb: Optional[int] = None,
        vcpus: Optional[float] = None,
        idle_ttl_seconds: Optional[int] = None,
        disk_gb: Optional[float] = None,
        github_repo: Optional[str] = None,
        image_name: Optional[str] = None,
        exposed_port: Optional[int] = None,
        public_web: Optional[bool] = None,
        health_check_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an agent and kick off its deploy.

        ``env`` items look like ``{"key": ..., "value": ..., "secret": True}``.

        Web-service agents (BYO image serving HTTP): declare the container
        port with ``exposed_port``; opt into the no-login public URL with
        ``public_web=True`` — the created agent's ``publicUrl`` then proxies
        to that port. ``health_check_path`` lets deploy readiness probe a
        route other than ``/``.
        """
        body: Dict[str, Any] = {
            "name": name,
            "templateId": template,
            "externalId": external_id,
            "description": description,
            "instructions": instructions,
            "tier": tier,
            "memMb": mem_mb,
            "vcpus": vcpus,
            "idleTtlSeconds": idle_ttl_seconds,
            "diskGb": disk_gb,
            "githubRepo": github_repo,
            "imageName": image_name,
            "exposedPort": exposed_port,
            "publicWeb": public_web,
            "healthCheckPath": health_check_path,
        }
        if env:
            body["initialEnvVars"] = [
                {"key": e["key"], "value": e["value"], "isSecret": e.get("secret", True)}
                for e in env
            ]
        body = {k: v for k, v in body.items() if v is not None}
        return self._http.request("POST", "/api/agents", body=body)

    def provision(self, external_id: str, name: str, *, template: str = "openclaw", **kwargs: Any) -> Dict[str, Any]:
        """Get-or-create an agent by ``external_id`` (idempotent — safe to call
        on every sign-in). Returns the existing agent if one exists."""
        existing = self.list(external_id=external_id)
        if existing:
            return existing[0]
        try:
            return self.create(name, template=template, external_id=external_id, **kwargs)
        except Exception:
            # Lost a race with a concurrent provisioner — re-read.
            raced = self.list(external_id=external_id)
            if raced:
                return raced[0]
            raise

    def get(self, agent_id: str) -> Dict[str, Any]:
        return self._http.request("GET", f"/api/agents/{_enc(agent_id)}")

    def list(self, *, external_id: Optional[str] = None, name: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._http.request(
            "GET", "/api/agents", query={"externalId": external_id, "name": name}
        ) or []

    def chat(self, agent_id: str, message: str, *, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        """Send a message and wait for the reply. Sleeping agents auto-wake.
        Returns ``{"response": str | None, "error"?: str}``."""
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/chat",
            body={"message": message, "conversation_id": conversation_id},
        )

    def start(self, agent_id: str) -> Dict[str, Any]:
        return self._lifecycle(agent_id, "start")

    def stop(self, agent_id: str) -> Dict[str, Any]:
        return self._lifecycle(agent_id, "stop")

    def sleep(self, agent_id: str) -> Dict[str, Any]:
        return self._lifecycle(agent_id, "sleep")

    def restart(self, agent_id: str) -> Dict[str, Any]:
        return self._lifecycle(agent_id, "restart")

    def delete(self, agent_id: str) -> None:
        self._http.request("DELETE", f"/api/agents/{_enc(agent_id)}")

    def list_env(self, agent_id: str) -> List[Dict[str, Any]]:
        return self._http.request("GET", f"/api/agents/{_enc(agent_id)}/env") or []

    def set_env(self, agent_id: str, key: str, value: str, *, secret: bool = True) -> Dict[str, Any]:
        """Set (upsert) an env var. Secrets are encrypted at rest; changes reach
        a running container after :meth:`reload_env` or a restart."""
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/env",
            body={"key": key, "value": value, "isSecret": secret},
        )

    def delete_env(self, agent_id: str, key: str) -> None:
        self._http.request("DELETE", f"/api/agents/{_enc(agent_id)}/env/{_enc(key)}")

    def reload_env(self, agent_id: str) -> Dict[str, Any]:
        return self._lifecycle(agent_id, "reload-env")

    def resize(
        self,
        agent_id: str,
        *,
        mem_mb: "int | None" = ...,
        disk_gb: "int | None" = ...,
        always_on: "bool | None" = None,
    ) -> Dict[str, Any]:
        """Change RAM / SSD allocation or always-on state. RAM/disk apply on
        the next restart; always-on is immediate. Pass ``None`` explicitly to
        clear a value back to the base allocation. Seat-billing accounts get
        a billing preview in the response; add-ons need a paid plan."""
        body: Dict[str, Any] = {}
        if mem_mb is not ...:
            body["mem_mb"] = mem_mb
        if disk_gb is not ...:
            body["disk_gb"] = disk_gb
        if always_on is not None:
            body["always_on"] = always_on
        return self._http.request(
            "POST", f"/api/agents/{_enc(agent_id)}/resize", body=body
        )

    def identity(self, agent_id: str) -> Dict[str, Any]:
        """The agent's provisioned real-world identity (Identity add-on).

        Returns ``phoneNumber``, ``emailAddress``, ``agentHandle``,
        ``tunnelHost`` and ``smsStatus``; channels never provisioned are
        ``None`` (an email-only agent has ``phoneNumber: None``), and a fresh
        phone number reports ``smsStatus: 'pending'`` during carrier warm-up.
        Raises :class:`MaritimeAPIError` (400) for agents without the add-on.
        """
        return self._http.request("GET", f"/api/inkbox/{_enc(agent_id)}")

    def logs(self, agent_id: str, *, limit: Optional[int] = None, level: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._http.request(
            "GET", f"/api/agents/{_enc(agent_id)}/logs", query={"limit": limit, "level": level}
        ) or []

    def exec(
        self,
        agent_id: str,
        command: str | List[str],
        *,
        timeout: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run a one-shot, non-interactive shell command in the agent's
        container (what ``maritime exec`` uses); wakes a sleeping agent.

        ``command`` is a raw shell string, or a list of argv tokens that the
        server shell-quotes for you. ``timeout`` is in seconds (default 60,
        max 120); output is capped at 256 KB. Returns ``{exitCode, stdout,
        stderr}``; runtimes return one merged stream, so ``stderr`` is
        always empty today.
        """
        return self._http.request(
            "POST",
            f"/api/agents/{_enc(agent_id)}/exec",
            body={"command": command, "timeout": timeout},
        )

    def _lifecycle(self, agent_id: str, action: str) -> Dict[str, Any]:
        return self._http.request(
            "POST", f"/api/agents/{_enc(agent_id)}/{action}", idempotent=True
        )


class Projects:
    """The HTTP front door — one agent per end-user of YOUR product. Access
    via ``client.projects``.

    Every agent belongs to a project (created automatically; the agent's
    ``projectId`` names it). Configure the project once, then route your
    end-users' messages through :meth:`message` — Maritime binds each
    ``external_user_id`` to its own agent (warm pool → spawn), wakes it,
    delivers, and returns the reply::

        agent = client.agents.create("support", template="openclaw")
        client.projects.update(agent["projectId"],
                               new_chat_policy="spawn", warm_pool_size=3)

        msg = client.projects.message(agent["projectId"],
                                      external_user_id=f"user_{uid}",
                                      message="What does my dashboard say?")
        if msg["status"] == "replied":
            print(msg["reply"])
        # else 'queued' | 'provisioning': poll get_message() or subscribe to
        # the 'message.reply' webhook event.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get(self, project_id: str) -> Dict[str, Any]:
        return self._http.request("GET", f"/api/projects/{_enc(project_id)}")

    def update(
        self,
        project_id: str,
        *,
        name: Optional[str] = None,
        new_chat_policy: Optional[str] = None,
        max_instances: Optional[int] = None,
        warm_pool_size: Optional[int] = None,
        instance_compute_minutes_limit: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Update routing policy (``single``/``assign``/``spawn``/``claim``),
        instance cap, warm-pool size, or the per-end-user compute cap stamped
        on newly spawned instances (0 clears it)."""
        body = {
            "name": name,
            "newChatPolicy": new_chat_policy,
            "maxInstances": max_instances,
            "warmPoolSize": warm_pool_size,
            "instanceComputeMinutesLimit": instance_compute_minutes_limit,
        }
        return self._http.request(
            "PATCH", f"/api/projects/{_enc(project_id)}",
            body={k: v for k, v in body.items() if v is not None},
        )

    def message(
        self,
        project_id: str,
        *,
        external_user_id: str,
        message: str,
        wait: Optional[int] = None,
        claim_code: Optional[str] = None,
        display_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send an end-user's message to their agent (get-or-create + wake +
        deliver).

        Returns the message state: ``status`` is ``replied`` (with ``reply``)
        when the agent answers within ``wait`` seconds (0-60, default 30);
        ``provisioning``/``queued`` when still working — poll
        :meth:`get_message` or receive a ``message.reply`` webhook. Pass
        ``idempotency_key`` if you retry sends (retries return the original
        message instead of delivering twice)."""
        body = {
            "externalUserId": external_user_id,
            "message": message,
            "wait": wait,
            "claimCode": claim_code,
            "displayName": display_name,
            "metadata": metadata,
        }
        return self._http.request(
            "POST",
            f"/api/v1/projects/{_enc(project_id)}/messages",
            body={k: v for k, v in body.items() if v is not None},
            headers={"Idempotency-Key": idempotency_key} if idempotency_key else None,
            idempotent=idempotency_key is not None,
        )

    def get_message(self, project_id: str, message_id: str) -> Dict[str, Any]:
        """Poll a message's state (the fallback when you skip webhooks)."""
        return self._http.request(
            "GET", f"/api/v1/projects/{_enc(project_id)}/messages/{_enc(message_id)}"
        )

    def users(self, project_id: str) -> List[Dict[str, Any]]:
        """List the project's end-users (every bound ``externalUserId``)."""
        return self._http.request("GET", f"/api/v1/projects/{_enc(project_id)}/users") or []

    def get_user(self, project_id: str, external_user_id: str) -> Dict[str, Any]:
        return self._http.request(
            "GET", f"/api/v1/projects/{_enc(project_id)}/users/{_enc(external_user_id)}"
        )

    def unbind_user(self, project_id: str, external_user_id: str) -> None:
        """Unbind an end-user. Their instance stays and rejoins the warm pool;
        to destroy it, ``client.agents.delete(user["agentId"])`` first."""
        self._http.request(
            "DELETE", f"/api/v1/projects/{_enc(project_id)}/users/{_enc(external_user_id)}"
        )


class Billing:
    """Usage & cost rollups for rebilling. Access via ``client.billing``.

    The report comes from the real money ledger (your wallet's agent-attributed
    debits) plus per-agent LLM spend. Each row carries ``externalUserId`` so
    grouping by YOUR end-user is a one-liner::

        report = client.billing.usage(from_="2026-07-01", to="2026-08-01")
        for row in report["agents"]:
            invoice(row["externalUserId"], row["totalCostCents"])
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def set_auto_recharge(
        self,
        *,
        enabled: bool,
        threshold_cents: Optional[int] = None,
        amount_cents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Configure auto-recharge: below ``threshold_cents`` the saved card is
        charged ``amount_cents`` (max 3x/24h, 6h backoff after a failure)."""
        body = {"enabled": enabled, "threshold_cents": threshold_cents,
                "amount_cents": amount_cents}
        return self._http.request(
            "POST", "/api/wallet/auto-recharge",
            body={k: v for k, v in body.items() if v is not None},
        )

    def get_auto_recharge(self) -> Dict[str, Any]:
        return self._http.request("GET", "/api/wallet/auto-recharge")

    def usage(
        self,
        *,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        project_id: Optional[str] = None,
        external_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Per-agent / per-end-user cost rollup over a date range (max 92 days,
        default last 30). Rows are sorted by ``totalCostCents`` descending."""
        return self._http.request(
            "GET", "/api/v1/usage",
            query={"from": from_, "to": to, "projectId": project_id,
                   "externalUserId": external_user_id},
        )


class Keys:
    """Manage API keys programmatically. Access via ``client.keys``."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        name: str,
        *,
        scopes: Optional[List[str]] = None,
        expires_in_days: Optional[int] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Mint a new key. The raw key is in ``["raw_key"]`` — shown once.

        ``project_id`` restricts the key to one project: it then only works on
        the front door + usage endpoints for that project and is rejected
        everywhere else — the key to hand a partner-facing/per-tenant service."""
        return self._http.request(
            "POST",
            "/api/v1/keys",
            body={
                "name": name,
                "scopes": scopes or ["provision", "deploy", "secrets", "manage"],
                "expires_in_days": expires_in_days,
                "project_id": project_id,
            },
        )

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/api/v1/keys") or []

    def revoke(self, key_id: str) -> None:
        self._http.request("DELETE", f"/api/v1/keys/{_enc(key_id)}")


class Webhooks:
    """Manage outbound webhook subscriptions. Access via ``client.webhooks``.

    Subscribe a URL to receive signed agent lifecycle events (agent.deployed,
    agent.error, agent.sleeping, agent.woken, agent.restarted, agent.stopped)
    instead of polling. Each delivery carries ``X-Maritime-Signature:
    sha256=<hmac>`` — verify it with the subscription's secret.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(self, url: str, *, events: Optional[List[str]] = None) -> Dict[str, Any]:
        """Create a subscription. The signing ``secret`` is in the result — once."""
        return self._http.request(
            "POST", "/api/v1/webhooks", body={"url": url, "events": events or []}
        )

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/api/v1/webhooks") or []

    def delete(self, subscription_id: str) -> None:
        self._http.request("DELETE", f"/api/v1/webhooks/{_enc(subscription_id)}")

    def test(self, subscription_id: str) -> Dict[str, Any]:
        """Deliver a synthetic ``ping`` and return the result."""
        return self._http.request("POST", f"/api/v1/webhooks/{_enc(subscription_id)}/test")


def _enc(value: str) -> str:
    from urllib.parse import quote

    return quote(str(value), safe="")


def _multipart(
    fields: Dict[str, str], file_field: str, filename: str, content: bytes
) -> tuple:
    """Encode one file + string fields as multipart/form-data (stdlib-only).

    Returns ``(body_bytes, content_type)``; quotes and newlines in
    ``filename`` are stripped so they can't break the part header.
    """
    import uuid

    boundary = uuid.uuid4().hex
    safe_name = filename.replace('"', "").replace("\r", "").replace("\n", "") or "upload.bin"
    parts: List[bytes] = []
    for key, value in fields.items():
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{file_field}"; filename="{safe_name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
    )
    parts.append(content)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
