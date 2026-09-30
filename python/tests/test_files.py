"""Tests for client.agents.files and client.agents.exec."""

import io
import json
import urllib.error
from typing import Any, Dict, List

import pytest

from maritime import Maritime, MaritimeConflictError, MaritimeNotFoundError


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
    """Patches urlopen; keeps raw (non-JSON) request bodies for multipart."""

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
                pass  # multipart bytes stay raw
        self.calls.append({
            "url": req.full_url,
            "method": req.get_method(),
            "body": body,
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
    def _patch(responses):
        t = MockTransport(responses)
        monkeypatch.setattr("urllib.request.urlopen", t)
        return t

    return _patch


def _client() -> Maritime:
    return Maritime(api_key="mk_test", base_url="https://api.example.test")


def test_list_defaults_to_volume_root(patch_transport):
    listing = {
        "path": "/zeroclaw-data",
        "root": "/zeroclaw-data",
        "entries": [{"name": "workspace", "isDir": True, "size": 0, "mtime": 1723900000}],
    }
    t = patch_transport([{"status": 200, "body": listing}])
    res = _client().agents.files.list("ag_1")
    assert res["root"] == "/zeroclaw-data"
    assert t.calls[0]["url"] == "https://api.example.test/api/agents/ag_1/files/list"


def test_download_returns_bytes(patch_transport):
    t = patch_transport([{"status": 200, "raw": b"PDFDATA"}])
    data = _client().agents.files.download("ag_1", "/tmp/report.pdf")
    assert data == b"PDFDATA"
    assert "path=%2Ftmp%2Freport.pdf" in t.calls[0]["url"]


def test_upload_sends_multipart(patch_transport):
    t = patch_transport([
        {"status": 200, "body": {"ok": True, "path": "/data/in/d.csv", "name": "d.csv", "size": 8}}
    ])
    res = _client().agents.files.upload(
        "ag_1", b"a,b\n1,2\n", "d.csv", dest_dir="/data/in"
    )
    assert res["path"] == "/data/in/d.csv"
    call = t.calls[0]
    assert call["method"] == "POST"
    assert call["headers"]["content-type"].startswith("multipart/form-data; boundary=")
    raw = call["body"]
    assert isinstance(raw, bytes)
    assert b'name="dest_dir"\r\n\r\n/data/in' in raw
    assert b'filename="d.csv"' in raw
    assert b"a,b\n1,2\n" in raw


def test_upload_filename_header_cannot_be_broken(patch_transport):
    t = patch_transport([
        {"status": 200, "body": {"ok": True, "path": "/data/inbox/x", "name": "x", "size": 1}}
    ])
    _client().agents.files.upload("ag_1", b"x", 'evil"\r\nname.txt')
    raw = t.calls[0]["body"]
    assert b'filename="evilname.txt"' in raw


def test_write_puts_json(patch_transport):
    t = patch_transport([{"status": 200, "body": {"ok": True, "path": "/data/a.md"}}])
    _client().agents.files.write("ag_1", "/data/a.md", "# hi")
    assert t.calls[0]["method"] == "PUT"
    assert t.calls[0]["body"] == {"path": "/data/a.md", "content": "# hi"}


def test_move_collision_raises_conflict(patch_transport):
    patch_transport([{"status": 409, "detail": "Destination already exists"}])
    with pytest.raises(MaritimeConflictError):
        _client().agents.files.move("ag_1", "/data/a", "/data/b")


def test_delete_missing_raises_not_found(patch_transport):
    patch_transport([{"status": 404, "detail": "File not found"}])
    with pytest.raises(MaritimeNotFoundError):
        _client().agents.files.delete("ag_1", "/data/ghost")


def test_mkdir_posts_path(patch_transport):
    t = patch_transport([{"status": 200, "body": {"ok": True, "path": "/data/new"}}])
    _client().agents.files.mkdir("ag_1", "/data/new")
    assert t.calls[0]["body"] == {"path": "/data/new"}


def test_exec_string_and_argv(patch_transport):
    t = patch_transport([
        {"status": 200, "body": {"exitCode": 0, "stdout": "hello\n", "stderr": ""}},
        {"status": 200, "body": {"exitCode": 1, "stdout": "", "stderr": ""}},
    ])
    res = _client().agents.exec("ag_1", "echo hello")
    assert res["exitCode"] == 0
    assert t.calls[0]["url"] == "https://api.example.test/api/agents/ag_1/exec"
    assert t.calls[0]["body"]["command"] == "echo hello"

    _client().agents.exec("ag_1", ["ls", "-la", "/data"], timeout=90)
    assert t.calls[1]["body"]["command"] == ["ls", "-la", "/data"]
    assert t.calls[1]["body"]["timeout"] == 90
