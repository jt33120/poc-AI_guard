"""Control API: audit listing + AI Act/GDPR exports (JSON & PDF) — M5."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit
from core.config import Settings
from tests.conftest import DBHandle


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_events(db: DBHandle, tenant_id: str) -> None:
    audit.log_event(db.conn, tenant_id=tenant_id, decision="allow", tool_name="crm.read")
    audit.log_event(db.conn, tenant_id=tenant_id, decision="deny", tool_name="crm.delete")
    audit.log_event(db.conn, tenant_id=tenant_id, decision="hitl_approved", tool_name="crm.update")


def test_list_audit_with_isolation_and_filter(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant_a, tenant_b = uuid4(), uuid4()
    db.conn.execute(
        "insert into tenants (id, name) values (%s, 'A'), (%s, 'B')", (tenant_a, tenant_b)
    )
    db.conn.commit()
    _seed_events(db, str(tenant_a))

    client = _client(db.url, test_verifier)
    token_a = make_token(tenant_id=str(tenant_a), role="viewer")
    token_b = make_token(tenant_id=str(tenant_b), role="admin")

    all_a = client.get("/v1/audit", headers=_auth(token_a)).json()
    assert {e["decision"] for e in all_a} == {"allow", "deny", "hitl_approved"}

    # B sees nothing (RLS isolation).
    assert client.get("/v1/audit", headers=_auth(token_b)).json() == []

    # Filter by decision.
    denied = client.get("/v1/audit?decision=deny", headers=_auth(token_a)).json()
    assert [e["tool_name"] for e in denied] == ["crm.delete"]


def test_export_json_and_pdf(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    _seed_events(db, str(tenant))
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="admin")

    js = client.get("/v1/audit/export?format=ai_act", headers=_auth(token))
    assert js.status_code == 200
    body = js.json()
    assert body["framework"] == "ai_act"
    assert body["event_count"] == 3
    assert "narrative" in body and "human_supervision" in body

    pdf = client.get("/v1/audit/export?format=rgpd&render=pdf", headers=_auth(token))
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


def test_export_invalid_format_returns_422(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant,))
    db.conn.commit()
    client = _client(db.url, test_verifier)
    token = make_token(tenant_id=str(tenant), role="admin")
    assert client.get("/v1/audit/export?format=bogus", headers=_auth(token)).status_code == 422
