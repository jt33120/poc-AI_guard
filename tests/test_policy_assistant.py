"""Natural-language policy assistant: validation gate + the /v1/policy/draft route."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import judge
from core.config import Settings
from core.policy import PolicyError
from core.policy_assistant import draft_policy
from tests.conftest import DBHandle

GOOD = "defaults:\n  unknown_tool: deny\n  auto_classify: true\n"
BAD = "tools: not-a-list"


def test_draft_returns_validated_yaml() -> None:
    out = draft_policy(lambda _s, _u: GOOD, "monitor my agent")
    assert "auto_classify: true" in out


def test_draft_strips_code_fences() -> None:
    out = draft_policy(lambda _s, _u: f"```yaml\n{GOOD}```", "x")
    assert out.startswith("defaults:")


def test_draft_repairs_invalid_then_succeeds() -> None:
    seen = {"n": 0}

    def completer(_s: str, _u: str) -> str:
        seen["n"] += 1
        return BAD if seen["n"] == 1 else GOOD

    out = draft_policy(completer, "x")
    assert "auto_classify" in out and seen["n"] == 2


def test_draft_raises_when_unrepairable() -> None:
    with pytest.raises(PolicyError):
        draft_policy(lambda _s, _u: BAD, "x")


def test_draft_raises_on_empty() -> None:
    with pytest.raises(PolicyError):
        draft_policy(lambda _s, _u: "", "x")


def _client(db_url: str, verifier: TokenVerifier, *, mistral: str | None) -> TestClient:
    app = create_app(
        Settings(_env_file=None, env="dev", database_url=db_url, mistral_api_key=mistral)
    )
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return tid


def test_draft_route_generates_policy(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = _tenant(db)
    monkeypatch.setattr(judge, "litellm_completer", lambda _m, _k: (lambda _s, _u: GOOD))
    client = _client(db.url, test_verifier, mistral="test-key")
    admin = make_token(tenant_id=tid, role="admin")
    resp = client.post(
        "/v1/policy/draft",
        headers={"Authorization": f"Bearer {admin}"},
        json={"prompt": "monitor everything my agent does, block deletes"},
    )
    assert resp.status_code == 200
    assert "auto_classify: true" in resp.json()["yaml"]


def test_draft_route_503_without_key(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier, mistral=None)
    admin = make_token(tenant_id=tid, role="admin")
    resp = client.post(
        "/v1/policy/draft", headers={"Authorization": f"Bearer {admin}"}, json={"prompt": "x"}
    )
    assert resp.status_code == 503


def test_draft_route_admin_only(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier, mistral="test-key")
    operator = make_token(tenant_id=tid, role="operator")
    resp = client.post(
        "/v1/policy/draft", headers={"Authorization": f"Bearer {operator}"}, json={"prompt": "x"}
    )
    assert resp.status_code == 403
