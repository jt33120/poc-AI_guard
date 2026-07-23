"""Control API: EU AI Act compliance status + evidence pack export (M9)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier, *, retention_days: int = 183) -> TestClient:
    app = create_app(
        Settings(
            _env_file=None, env="dev", database_url=db_url, audit_retention_days=retention_days
        )
    )
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def test_status_ready_when_clean(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="hitl_approved", action_class="irreversible"
    )
    audit.log_event(db.conn, tenant_id=tenant, decision="allow", action_class="read")
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="viewer")

    r = client.get("/v1/compliance/status", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["chain_ok"] is True
    assert body["oversight_coverage_ok"] is True
    assert body["retention_ok"] is True
    assert body["ready"] is True


def test_status_flags_oversight_gap(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    # An irreversible action auto-allowed = an oversight gap -> not ready.
    audit.log_event(db.conn, tenant_id=tenant, decision="allow", action_class="irreversible")
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="viewer")

    body = client.get("/v1/compliance/status", headers=_auth(token)).json()
    assert body["oversight_auto_allowed"] == 1
    assert body["oversight_coverage_ok"] is False
    assert body["ready"] is False


def test_status_not_ready_when_retention_floor_too_low(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(db.conn, tenant_id=tenant, decision="allow", action_class="read")
    client = _client(db.url, test_verifier, retention_days=90)  # below the 183-day floor
    token = make_token(tenant_id=tenant, role="viewer")

    body = client.get("/v1/compliance/status", headers=_auth(token)).json()
    assert body["retention_floor_days"] == 90
    assert body["retention_ok"] is False
    assert body["ready"] is False


def test_status_is_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(db.conn, tenant_id=tenant, decision="allow", action_class="read")
    client = _client(db.url, test_verifier)
    other = make_token(tenant_id=str(uuid4()), role="viewer")

    body = client.get("/v1/compliance/status", headers=_auth(other)).json()
    assert body["entries"] == 0  # RLS: another tenant sees none of these events


def test_export_json_and_pdf(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="hitl_approved", action_class="irreversible"
    )
    audit.log_event(db.conn, tenant_id=tenant, decision="deny", action_class="external_send")
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="admin")

    js = client.get("/v1/compliance/export", headers=_auth(token))
    assert js.status_code == 200
    body = js.json()
    assert body["standard"].startswith("EU AI Act")
    assert body["articles"]["article_12_record_keeping"]["tamper_evident"] is True
    assert "fria" in body["articles"]["article_26_deployer"]

    pdf = client.get("/v1/compliance/export?render=pdf", headers=_auth(token))
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


def test_export_invalid_render_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=tenant, role="admin")
    assert client.get("/v1/compliance/export?render=bogus", headers=_auth(token)).status_code == 422
