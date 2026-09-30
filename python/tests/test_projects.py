"""Tests for the projects (HTTP front door) resource + webhook verification."""

import hashlib
import hmac
import json
import urllib.request
from typing import Any, Dict, List

import pytest

from maritime import Maritime, verify_webhook_signature

from test_client import MockTransport


@pytest.fixture
def transport(monkeypatch):
    def make(responses: List[Dict[str, Any]]) -> MockTransport:
        t = MockTransport(responses)
        monkeypatch.setattr(urllib.request, "urlopen", t)
        return t

    return make


def client() -> Maritime:
    return Maritime(api_key="mk_test", base_url="https://api.example.test")


REPLIED = {
    "messageId": "msg_1",
    "externalUserId": "user_42",
    "agentId": "ag_1",
    "status": "replied",
    "reply": "hello back",
    "error": None,
    "userCreated": True,
    "metadata": None,
    "createdAt": "2026-07-12T00:00:00Z",
    "repliedAt": "2026-07-12T00:00:02Z",
}


def test_message_posts_camelcase_body(transport):
    t = transport([{"status": 200, "body": REPLIED}])
    msg = client().projects.message(
        "proj_1", external_user_id="user_42", message="hi", wait=10,
        metadata={"threadId": "t1"},
    )
    assert msg["status"] == "replied" and msg["reply"] == "hello back"
    call = t.calls[0]
    assert call["url"] == "https://api.example.test/api/v1/projects/proj_1/messages"
    assert call["method"] == "POST"
    assert call["body"] == {
        "externalUserId": "user_42", "message": "hi", "wait": 10,
        "metadata": {"threadId": "t1"},
    }
    assert "idempotency-key" not in call["headers"]


def test_message_sends_idempotency_key(transport):
    t = transport([{"status": 200, "body": REPLIED}])
    client().projects.message(
        "proj_1", external_user_id="user_42", message="hi", idempotency_key="send-778",
    )
    assert t.calls[0]["headers"]["idempotency-key"] == "send-778"


def test_message_returns_202_state(transport):
    body = dict(REPLIED, status="provisioning", reply=None, repliedAt=None)
    transport([{"status": 202, "body": body}])
    msg = client().projects.message("proj_1", external_user_id="u_new", message="hi", wait=0)
    assert msg["status"] == "provisioning" and msg["reply"] is None


def test_resource_paths(transport):
    t = transport([
        {"status": 200, "body": {}}, {"status": 200, "body": []},
        {"status": 200, "body": {}}, {"status": 204}, {"status": 200, "body": {}},
    ])
    p = client().projects
    p.get_message("p1", "m1")
    p.users("p1")
    p.get_user("p1", "user@a:b")
    p.unbind_user("p1", "user@a:b")
    p.update("p1", new_chat_policy="spawn", warm_pool_size=3)
    paths = [(c["method"], c["url"].split("api.example.test")[1]) for c in t.calls]
    assert paths == [
        ("GET", "/api/v1/projects/p1/messages/m1"),
        ("GET", "/api/v1/projects/p1/users"),
        ("GET", "/api/v1/projects/p1/users/user%40a%3Ab"),
        ("DELETE", "/api/v1/projects/p1/users/user%40a%3Ab"),
        ("PATCH", "/api/projects/p1"),
    ]
    assert t.calls[4]["body"] == {"newChatPolicy": "spawn", "warmPoolSize": 3}


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_webhook_signature():
    secret = "whsec_test_secret"
    body = json.dumps({"event": "message.reply", "message_id": "m1"}).encode()

    assert verify_webhook_signature(secret, body, _sign(secret, body)) is True
    assert verify_webhook_signature(secret, body.decode(), _sign(secret, body)) is True  # str body
    assert verify_webhook_signature(secret, body + b"x", _sign(secret, body)) is False
    assert verify_webhook_signature("whsec_other", body, _sign(secret, body)) is False
    assert verify_webhook_signature(secret, body, None) is False
    assert verify_webhook_signature(secret, body, "md5=abc") is False


def test_billing_usage_query(transport):
    t = transport([{"status": 200, "body": {"agents": []}}])
    client().billing.usage(from_="2026-07-01", to="2026-08-01",
                           project_id="p1", external_user_id="cust_9")
    url = t.calls[0]["url"]
    assert url.startswith("https://api.example.test/api/v1/usage?")
    assert "from=2026-07-01" in url and "to=2026-08-01" in url
    assert "projectId=p1" in url and "externalUserId=cust_9" in url
