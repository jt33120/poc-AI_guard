"""Per-tenant DLP config: GET/PUT + RBAC + it overrides env in the proxy."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

AWS_KEY = "AKIAIOSFODNN7EXAMPLE"


class _FakeResp:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.status_code = 200
        self.content = json.dumps(payload).encode()
        self.headers = {"content-type": "application/json"}
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeClient:
    is_closed = False

    def __init__(self, resp: _FakeResp) -> None:
        self._resp = resp
        self.captured: dict[str, Any] = {}

    async def post(self, url: str, content: bytes, headers: dict[str, str]) -> _FakeResp:
        self.captured = {"url": url, "headers": headers, "content": content}
        return self._resp


def _client(db_url: str, verifier: TokenVerifier, **kw: Any) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url, **kw))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'P')", (tid,))
    db.conn.commit()
    return tid


def test_get_defaults_to_platform_env(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier, dlp_enabled=True, dlp_pii_action="redact")
    viewer = make_token(tenant_id=tid, role="viewer")
    cfg = client.get("/v1/dlp", headers={"Authorization": f"Bearer {viewer}"}).json()
    # No row yet → the platform env defaults are reported.
    assert cfg["enabled"] is True
    assert cfg["secret_action"] == "block" and cfg["pii_action"] == "redact"
    assert cfg["platform_enabled"] is True


def test_put_requires_admin(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = make_token(tenant_id=tid, role="viewer")
    resp = client.put(
        "/v1/dlp",
        headers={"Authorization": f"Bearer {viewer}"},
        json={"enabled": True, "secret_action": "block", "pii_action": "flag"},
    )
    assert resp.status_code == 403


def test_admin_can_save_and_read_back(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tid, role="admin")
    put = client.put(
        "/v1/dlp",
        headers={"Authorization": f"Bearer {admin}"},
        json={"enabled": True, "secret_action": "flag", "pii_action": "block"},
    )
    assert put.status_code == 200
    cfg = client.get("/v1/dlp", headers={"Authorization": f"Bearer {admin}"}).json()
    assert cfg["enabled"] is True
    assert cfg["secret_action"] == "flag" and cfg["pii_action"] == "block"


def test_tenant_config_overrides_env_in_the_proxy(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    # Platform default would BLOCK secrets; the tenant relaxes secrets to flag.
    client = _client(db.url, test_verifier, dlp_enabled=True)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": "tools: []"}
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]
    client.put(
        "/v1/dlp",
        headers={"Authorization": f"Bearer {admin}"},
        json={"enabled": True, "secret_action": "flag", "pii_action": "flag"},
    )

    fake = _FakeClient(_FakeResp({"id": "x", "choices": [], "usage": {}}))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": f"deploy with {AWS_KEY}"}],
        },
    )
    # Secret is flagged (not blocked) per the tenant's override → forwarded.
    assert resp.status_code == 200
    assert fake.captured != {}
    with psycopg.connect(db.url) as check:
        decision = check.execute(
            "select decision from audit_log where tenant_id = %s and tool_name = 'openai.egress'",
            (tid,),
        ).fetchone()
    assert decision is not None and decision[0] == "flag"


def test_tenant_can_disable_dlp_despite_platform_on(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier, dlp_enabled=True)
    admin = make_token(tenant_id=tid, role="admin")
    client.put(
        "/v1/policy", headers={"Authorization": f"Bearer {admin}"}, json={"yaml": "tools: []"}
    )
    raw = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    ).json()["token"]
    client.put(
        "/v1/dlp",
        headers={"Authorization": f"Bearer {admin}"},
        json={"enabled": False, "secret_action": "block", "pii_action": "flag"},
    )

    fake = _FakeClient(_FakeResp({"id": "x", "choices": [], "usage": {}}))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    resp = client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": f"deploy with {AWS_KEY}"}],
        },
    )
    # Tenant turned DLP off → the secret is forwarded even though the platform is on.
    assert resp.status_code == 200
    assert fake.captured != {}
