"""Tests for client.computers and client.computers.files (ported from
typescript/test/computers.test.ts)."""

import io
import json
import urllib.error
from typing import Any, Dict, List

import pytest

from maritime import (
    Maritime,
    MaritimeAPIError,
    MaritimeConflictError,
    MaritimeNotFoundError,
    MaritimePaymentRequiredError,
    MaritimeRateLimitError,
)

BASE = "https://api.example.test/api/v1/computers"


class _Resp:
    def __init__(self, status: int, body: Any, raw: "bytes | None" = None):
        self.status = status
        if raw is not None:
            self._body = raw
        else:
            self._body = b"" if body is None else json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class MockTransport:
    """Patches urlopen; keeps raw (non-JSON) request bodies for file writes."""

    def __init__(self, responses: List[Dict[str, Any]]):
        self.responses = responses
        self.calls: List[Dict[str, Any]] = []
        self._i = 0

    def __call__(self, req, timeout=None):
        body = req.data
        if body is not None:
            try:
                body = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                pass
        self.calls.append({
            "url": req.full_url,
            "method": req.get_method(),
            "body": body,
            "raw": req.data,
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
        return _Resp(status, r.get("body"), r.get("raw"))


@pytest.fixture
def patch_transport(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)  # no real backoff

    def _patch(responses):
        t = MockTransport(responses)
        monkeypatch.setattr("urllib.request.urlopen", t)
        return t

    return _patch


def _client(**kw) -> Maritime:
    return Maritime(api_key="mk_test", base_url="https://api.example.test", **kw)


COMPUTER = {"id": "cmp_1", "externalUserId": "user_42", "status": "sleeping"}


# ---- create / list / get / delete ----

def test_create_sends_external_user_id_and_name(patch_transport):
    t = patch_transport([{"status": 201, "body": COMPUTER}])
    out = _client().computers.create(external_user_id="user_42", name="desk")
    assert out == COMPUTER
    assert t.calls[0]["method"] == "POST"
    assert t.calls[0]["url"] == BASE
    assert t.calls[0]["body"] == {"externalUserId": "user_42", "name": "desk"}


def test_create_with_external_user_id_is_retried_on_503(patch_transport):
    t = patch_transport([{"status": 503}, {"status": 200, "body": COMPUTER}])
    assert _client().computers.create(external_user_id="user_42") == COMPUTER
    assert len(t.calls) == 2


def test_create_anonymous_sends_empty_body_and_is_not_retried_on_500(patch_transport):
    t = patch_transport([{"status": 500}, {"status": 201, "body": COMPUTER}])
    with pytest.raises(MaritimeAPIError):
        _client().computers.create()
    assert len(t.calls) == 1
    assert t.calls[0]["body"] == {}


def test_list_passes_external_user_id_and_unwraps(patch_transport):
    t = patch_transport([{"status": 200, "body": {"computers": [COMPUTER]}}])
    assert _client().computers.list(external_user_id="user_42") == [COMPUTER]
    assert t.calls[0]["url"] == f"{BASE}?externalUserId=user_42"


def test_list_without_filter_has_no_query(patch_transport):
    t = patch_transport([{"status": 200, "body": {"computers": []}}])
    assert _client().computers.list() == []
    assert t.calls[0]["url"] == BASE


def test_get_encodes_id(patch_transport):
    t = patch_transport([{"status": 200, "body": COMPUTER}])
    _client().computers.get("a/b")
    assert t.calls[0]["url"] == f"{BASE}/a%2Fb"


def test_get_missing_raises_not_found(patch_transport):
    patch_transport([{"status": 404, "detail": "Computer not found"}])
    with pytest.raises(MaritimeNotFoundError, match="Computer not found"):
        _client().computers.get("nope")


def test_delete_returns_none_on_204(patch_transport):
    t = patch_transport([{"status": 204}])
    assert _client().computers.delete("cmp_1") is None
    assert t.calls[0]["method"] == "DELETE"


# ---- wake / sleep ----

def test_wake_posts_and_returns_wake_result(patch_transport):
    res = {"status": "running", "wakeMs": 840, "method": "snapshot"}
    t = patch_transport([{"status": 200, "body": res}])
    assert _client().computers.wake("cmp_1") == res
    assert t.calls[0]["method"] == "POST"
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/wake"


def test_wake_is_retried_on_500(patch_transport):
    t = patch_transport([{"status": 500}, {"status": 200, "body": {"status": "running"}}])
    _client().computers.wake("cmp_1")
    assert len(t.calls) == 2


def test_wake_402_raises_payment_required(patch_transport):
    patch_transport([{"status": 402, "detail": "Plan limit reached"}])
    with pytest.raises(MaritimePaymentRequiredError, match="Plan limit"):
        _client().computers.wake("cmp_1")


def test_sleep_posts(patch_transport):
    t = patch_transport([{"status": 200, "body": COMPUTER}])
    assert _client().computers.sleep("cmp_1") == COMPUTER
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/sleep"


# ---- act ----

def test_act_single_merges_format_and_quality(patch_transport):
    res = {"ok": True, "frameId": 3, "width": 1280, "height": 800, "imageB64": "aGk="}
    t = patch_transport([{"status": 200, "body": res}])
    action = {"action": "left_click", "coordinate": [640, 375]}
    assert _client().computers.act("cmp_1", action, format="jpeg", quality=70) == res
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/actions"
    assert t.calls[0]["body"] == {
        "action": "left_click", "coordinate": [640, 375], "format": "jpeg", "quality": 70,
    }


def test_act_single_without_options_sends_action_as_is(patch_transport):
    t = patch_transport([{"status": 200, "body": {"ok": True}}])
    action = {"action": "scroll", "coordinate": [10, 20], "scrollDirection": "down",
              "scrollAmount": 3, "noScreenshot": True}
    _client().computers.act("cmp_1", action)
    assert t.calls[0]["body"] == action


def test_act_batch_sends_actions_and_unwraps_results(patch_transport):
    results = [{"ok": True}, {"ok": True}]
    t = patch_transport([{"status": 200, "body": {"results": results}}])
    actions = [{"action": "type", "text": "hi"}, {"action": "key", "key": "Return"}]
    assert _client().computers.act("cmp_1", actions, format="png") == results
    assert t.calls[0]["body"] == {"actions": actions, "format": "png"}


def test_act_409_raises_conflict(patch_transport):
    patch_transport([{"status": 409, "detail": "A person is controlling this desktop"}])
    with pytest.raises(MaritimeConflictError, match="person"):
        _client().computers.act("cmp_1", {"action": "screenshot"})


def test_act_402_raises_payment_required(patch_transport):
    patch_transport([{"status": 402, "detail": "Session limit"}])
    with pytest.raises(MaritimePaymentRequiredError):
        _client().computers.act("cmp_1", {"action": "screenshot"})


def test_act_429_raises_rate_limit(patch_transport):
    t = patch_transport([{"status": 429, "detail": "Concurrency cap"}])
    with pytest.raises(MaritimeRateLimitError):
        _client(max_retries=0).computers.act("cmp_1", {"action": "screenshot"})
    assert len(t.calls) == 1


# ---- screenshot / exec ----

def test_screenshot_returns_bytes_and_passes_query(patch_transport):
    png = b"\x89PNG\r\n\x1a\nfake"
    t = patch_transport([{"status": 200, "raw": png}])
    assert _client().computers.screenshot("cmp_1", format="jpeg", quality=60) == png
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/screenshot?format=jpeg&quality=60"


def test_screenshot_without_options_has_no_query(patch_transport):
    t = patch_transport([{"status": 200, "raw": b"x"}])
    _client().computers.screenshot("cmp_1")
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/screenshot"


def test_exec_sends_timeout_s(patch_transport):
    res = {"exitCode": 0, "stdout": "hi\n", "stderr": ""}
    t = patch_transport([{"status": 200, "body": res}])
    assert _client().computers.exec("cmp_1", "echo hi", timeout_s=10) == res
    assert t.calls[0]["body"] == {"command": "echo hi", "timeoutS": 10}


def test_exec_omits_timeout_s_when_not_given(patch_transport):
    t = patch_transport([{"status": 200, "body": {"exitCode": 0}}])
    _client().computers.exec("cmp_1", "ls")
    assert t.calls[0]["body"] == {"command": "ls"}


# ---- files ----

def test_files_read_returns_bytes(patch_transport):
    t = patch_transport([{"status": 200, "raw": b"\x00\x01data"}])
    assert _client().computers.files.read("cmp_1", "/data/a.bin") == b"\x00\x01data"
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/files?path=%2Fdata%2Fa.bin"


def test_files_write_encodes_str_as_utf8_octet_stream(patch_transport):
    t = patch_transport([{"status": 204}])
    assert _client().computers.files.write("cmp_1", "/data/n.txt", "héllo") is None
    call = t.calls[0]
    assert call["method"] == "PUT"
    assert call["raw"] == "héllo".encode("utf-8")
    assert call["headers"]["content-type"] == "application/octet-stream"


def test_files_write_sends_bytes_untouched(patch_transport):
    t = patch_transport([{"status": 204}])
    _client().computers.files.write("cmp_1", "/data/b.bin", b"\xff\x00")
    assert t.calls[0]["raw"] == b"\xff\x00"


def test_files_list(patch_transport):
    listing = {"path": "/data", "entries": [{"name": "a", "type": "file"}]}
    t = patch_transport([{"status": 200, "body": listing}])
    assert _client().computers.files.list("cmp_1", "/data") == listing
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/files/list?path=%2Fdata"


# ---- viewer / sessions / usage ----

def test_viewer_sends_mode_ttl_reason(patch_transport):
    link = {"url": "https://maritime.sh/v/x", "expiresAt": "2026-11-21T00:00:00Z", "mode": "control"}
    t = patch_transport([{"status": 200, "body": link}])
    out = _client().computers.viewer("cmp_1", mode="control", ttl_s=600, reason="Log in")
    assert out == link
    assert t.calls[0]["body"] == {"mode": "control", "ttlS": 600, "reason": "Log in"}


def test_viewer_defaults_to_watch(patch_transport):
    t = patch_transport([{"status": 200, "body": {"url": "u", "mode": "watch"}}])
    _client().computers.viewer("cmp_1")
    assert t.calls[0]["body"] == {"mode": "watch"}


def test_close_session_returns_session(patch_transport):
    session = {"id": "ses_1", "endReason": "closed"}
    t = patch_transport([{"status": 200, "body": session}])
    assert _client().computers.close_session("cmp_1") == session
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/sessions/close"


def test_close_session_returns_none_when_no_session(patch_transport):
    patch_transport([{"status": 204}])
    assert _client().computers.close_session("cmp_1") is None


def test_sessions_unwraps(patch_transport):
    t = patch_transport([{"status": 200, "body": {"sessions": [{"id": "ses_1"}]}}])
    assert _client().computers.sessions("cmp_1") == [{"id": "ses_1"}]
    assert t.calls[0]["url"] == f"{BASE}/cmp_1/sessions"


def test_usage_passes_query(patch_transport):
    t = patch_transport([{"status": 200, "body": {"computers": []}}])
    _client().computers.usage(from_="2026-11-01", to="2026-11-21", external_user_id="u")
    assert t.calls[0]["url"] == f"{BASE}/usage?from=2026-11-01&to=2026-11-21&externalUserId=u"


# ---- path encoding everywhere ----

@pytest.mark.parametrize("call,suffix", [
    (lambda c: c.computers.get("a/b"), ""),
    (lambda c: c.computers.delete("a/b"), ""),
    (lambda c: c.computers.wake("a/b"), "/wake"),
    (lambda c: c.computers.sleep("a/b"), "/sleep"),
    (lambda c: c.computers.act("a/b", {"action": "screenshot"}), "/actions"),
    (lambda c: c.computers.screenshot("a/b"), "/screenshot"),
    (lambda c: c.computers.exec("a/b", "ls"), "/exec"),
    (lambda c: c.computers.viewer("a/b"), "/viewer"),
    (lambda c: c.computers.close_session("a/b"), "/sessions/close"),
    (lambda c: c.computers.sessions("a/b"), "/sessions"),
    (lambda c: c.computers.files.read("a/b", "/x"), "/files?path=%2Fx"),
    (lambda c: c.computers.files.write("a/b", "/x", b""), "/files?path=%2Fx"),
    (lambda c: c.computers.files.list("a/b", "/x"), "/files/list?path=%2Fx"),
])
def test_ids_are_path_encoded(patch_transport, call, suffix):
    t = patch_transport([{"status": 200, "body": {"sessions": [], "results": []}, "raw": None}])
    call(_client())
    assert t.calls[0]["url"] == f"{BASE}/a%2Fb{suffix}"
