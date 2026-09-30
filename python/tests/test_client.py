import io
import json
import urllib.error
from typing import Any, Dict, List, Optional

import pytest

from maritime import (
    Maritime,
    MaritimeAuthError,
    MaritimeConflictError,
    MaritimeError,
    MaritimeNotFoundError,
    MaritimePaymentRequiredError,
)


class _Resp:
    """Minimal stand-in for the object returned by urlopen()."""

    def __init__(self, status: int, body: Any):
        self.status = status
        self._body = b"" if body is None else json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class MockTransport:
    """Patches urllib.request.urlopen to return queued responses + record calls."""

    def __init__(self, responses: List[Dict[str, Any]]):
        self.responses = responses
        self.calls: List[Dict[str, Any]] = []
        self._i = 0

    def __call__(self, req, timeout=None):
        self.calls.append({
            "url": req.full_url,
            "method": req.get_method(),
            "body": json.loads(req.data) if req.data else None,
            "headers": {k.lower(): v for k, v in req.headers.items()},
        })
        r = self.responses[min(self._i, len(self.responses) - 1)]
        self._i += 1
        status = r["status"]
        if status >= 400:
            raise urllib.error.HTTPError(
                req.full_url, status, r.get("detail", "err"),
                {"content-type": "application/json"},
                io.BytesIO(json.dumps({"detail": r.get("detail", "err")}).encode()),
            )
        return _Resp(status, r.get("body"))


@pytest.fixture
def make_client(monkeypatch):
    def _make(responses, **kw):
        transport = MockTransport(responses)
        monkeypatch.setattr("urllib.request.urlopen", transport)
        client = Maritime(api_key="mk_test", base_url="https://api.example.test", max_retries=kw.get("max_retries", 2))
        return client, transport
    return _make


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("MARITIME_API_KEY", raising=False)
    with pytest.raises(MaritimeError):
        Maritime()


def test_bearer_and_json(make_client):
    client, t = make_client([{"status": 200, "body": [{"id": "a1"}]}])
    agents = client.agents.list()
    assert agents == [{"id": "a1"}]
    assert t.calls[0]["headers"]["authorization"] == "Bearer mk_test"
    assert t.calls[0]["url"] == "https://api.example.test/api/agents"


def test_create_body_camelcase(make_client):
    client, t = make_client([{"status": 201, "body": {"id": "a1"}}])
    client.agents.create("x", template="openclaw", external_id="c1", env=[{"key": "F", "value": "b"}])
    body = t.calls[0]["body"]
    assert body["templateId"] == "openclaw"
    assert body["externalId"] == "c1"
    assert body["initialEnvVars"] == [{"key": "F", "value": "b", "isSecret": True}]


def test_create_web_service_fields(make_client):
    client, t = make_client([{"status": 201, "body": {"id": "a1"}}])
    client.agents.create(
        "web", image_name="ghcr.io/acme/app:1", exposed_port=7999,
        public_web=True, health_check_path="/healthz",
    )
    body = t.calls[0]["body"]
    assert body["imageName"] == "ghcr.io/acme/app:1"
    assert body["exposedPort"] == 7999
    assert body["publicWeb"] is True
    assert body["healthCheckPath"] == "/healthz"
    # Omitted web fields must not appear in the body at all.
    client.agents.create("plain", template="openclaw")
    assert "exposedPort" not in t.calls[1]["body"]
    assert "publicWeb" not in t.calls[1]["body"]


def test_chat_conversation_id(make_client):
    client, t = make_client([{"status": 200, "body": {"response": "hi"}}])
    r = client.agents.chat("a1", "hello", conversation_id="c1")
    assert r["response"] == "hi"
    assert t.calls[0]["body"] == {"message": "hello", "conversation_id": "c1"}


def test_list_external_id_query(make_client):
    client, t = make_client([{"status": 200, "body": []}])
    client.agents.list(external_id="cust_9")
    assert "externalId=cust_9" in t.calls[0]["url"]


def test_delete_204(make_client):
    client, t = make_client([{"status": 204}])
    assert client.agents.delete("a1") is None


@pytest.mark.parametrize("status,klass", [
    (401, MaritimeAuthError),
    (403, MaritimeAuthError),
    (402, MaritimePaymentRequiredError),
    (404, MaritimeNotFoundError),
    (409, MaritimeConflictError),
])
def test_typed_errors(make_client, status, klass):
    client, _ = make_client([{"status": status, "detail": "boom"}])
    with pytest.raises(klass):
        client.agents.get("a1")


def test_error_exposes_status_detail(make_client):
    client, _ = make_client([{"status": 404, "detail": "no such agent"}])
    with pytest.raises(MaritimeNotFoundError) as exc:
        client.agents.get("a1")
    assert exc.value.status == 404
    assert exc.value.detail == "no such agent"


def test_retry_503_then_ok(make_client):
    client, t = make_client([{"status": 503, "detail": "down"}, {"status": 200, "body": [{"id": "ok"}]}])
    assert client.agents.list() == [{"id": "ok"}]
    assert len(t.calls) == 2


def test_no_retry_post_500(make_client):
    client, t = make_client([{"status": 500, "detail": "err"}, {"status": 201, "body": {"id": "nope"}}], max_retries=3)
    with pytest.raises(MaritimeError) as exc:
        client.agents.create("x", template="openclaw")
    assert exc.value.status == 500
    assert len(t.calls) == 1


def test_webhooks_create_list_delete_test(make_client):
    client, t = make_client([
        {"status": 201, "body": {"id": "wh1", "url": "https://x.test/h", "events": ["agent.error"], "secret": "whsec_x"}},
        {"status": 200, "body": []},
        {"status": 204},
        {"status": 200, "body": {"delivered": True, "status_code": 200}},
    ])
    created = client.webhooks.create("https://x.test/h", events=["agent.error"])
    assert created["secret"] == "whsec_x"
    assert t.calls[0]["url"].endswith("/api/v1/webhooks")
    assert t.calls[0]["body"] == {"url": "https://x.test/h", "events": ["agent.error"]}

    client.webhooks.list()
    assert t.calls[1]["method"] == "GET"

    client.webhooks.delete("wh1")
    assert t.calls[2]["method"] == "DELETE"
    assert t.calls[2]["url"].endswith("/api/v1/webhooks/wh1")

    r = client.webhooks.test("wh1")
    assert r["delivered"] is True
    assert t.calls[3]["url"].endswith("/api/v1/webhooks/wh1/test")


def test_provision_returns_existing(make_client):
    client, t = make_client([{"status": 200, "body": [{"id": "existing", "externalId": "c1"}]}])
    a = client.agents.provision(external_id="c1", name="x")
    assert a["id"] == "existing"
    assert len(t.calls) == 1  # only the list, no create


def test_provision_creates_when_absent(make_client):
    client, t = make_client([
        {"status": 200, "body": []},
        {"status": 201, "body": {"id": "new", "externalId": "c2"}},
    ])
    a = client.agents.provision(external_id="c2", name="x")
    assert a["id"] == "new"
    assert len(t.calls) == 2
    assert t.calls[1]["body"]["templateId"] == "openclaw"


def test_identity_reads_inkbox_path(make_client):
    client, t = make_client([{"status": 200, "body": {
        "phoneNumber": None,
        "emailAddress": "maritime-abc@inkboxmail.com",
        "agentHandle": "maritime-abc",
        "tunnelHost": "maritime-abc.inkboxwire.com",
        "smsStatus": None,
    }}])
    identity = client.agents.identity("a1")
    assert t.calls[0]["url"] == "https://api.example.test/api/inkbox/a1"
    assert identity["emailAddress"] == "maritime-abc@inkboxmail.com"
    assert identity["phoneNumber"] is None


def test_skills_upload_base64_and_needs_input(make_client):
    client, t = make_client([{"status": 200, "body": {
        "ok": True, "name": "goplaces", "status": "needs_input",
        "missing": {"env": ["GOOGLE_PLACES_API_KEY"]},
    }}])
    result = client.agents.skills.upload("a1", b"---\nname: goplaces\n---\n", env={"A_KEY": "v"})
    assert result["status"] == "needs_input"
    body = t.calls[0]["body"]
    import base64
    assert base64.b64decode(body["archiveBase64"]).startswith(b"---")
    assert body["env"] == {"A_KEY": "v"}
    assert t.calls[0]["url"] == "https://api.example.test/api/agents/a1/skills/upload"


def test_skills_paths_and_binary_export(make_client, monkeypatch):
    client, t = make_client([{"status": 200, "body": {"ok": True}}])
    client.agents.skills.install("a1", slug="weather")
    assert t.calls[0]["url"].endswith("/api/agents/a1/skills/install")
    client.agents.skills.remove("a1", "weather")
    assert t.calls[1]["method"] == "DELETE"
    assert t.calls[1]["url"].endswith("/api/agents/a1/skills/weather")
