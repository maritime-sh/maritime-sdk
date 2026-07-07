"""Resource namespaces: ``client.agents`` and ``client.keys``."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._http import HttpClient


class Agents:
    """Operations on Maritime agents. Access via ``client.agents``."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        name: str,
        *,
        template: Optional[str] = None,
        external_id: Optional[str] = None,
        description: Optional[str] = None,
        instructions: Optional[str] = None,
        tier: Optional[str] = None,
        env: Optional[List[Dict[str, Any]]] = None,
        mem_mb: Optional[int] = None,
        vcpus: Optional[float] = None,
        idle_ttl_seconds: Optional[int] = None,
        disk_gb: Optional[float] = None,
        github_repo: Optional[str] = None,
        image_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an agent and kick off its deploy.

        ``env`` items look like ``{"key": ..., "value": ..., "secret": True}``.
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

    def logs(self, agent_id: str, *, limit: Optional[int] = None, level: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._http.request(
            "GET", f"/api/agents/{_enc(agent_id)}/logs", query={"limit": limit, "level": level}
        ) or []

    def _lifecycle(self, agent_id: str, action: str) -> Dict[str, Any]:
        return self._http.request(
            "POST", f"/api/agents/{_enc(agent_id)}/{action}", idempotent=True
        )


class Keys:
    """Manage API keys programmatically. Access via ``client.keys``."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(self, name: str, *, scopes: Optional[List[str]] = None, expires_in_days: Optional[int] = None) -> Dict[str, Any]:
        """Mint a new key. The raw key is in ``["raw_key"]`` — shown once."""
        return self._http.request(
            "POST",
            "/api/v1/keys",
            body={
                "name": name,
                "scopes": scopes or ["provision", "deploy", "secrets", "manage"],
                "expires_in_days": expires_in_days,
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
