"""Control API: per-tool earned-trust view (M11)."""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit
from core.config import Settings
from tests.conftest import DBHandle

# `log_event` requires the ingestion adapter to name its door (FR-160). These
# tests exercise the audit store itself, not a door, so they all state the same
# one; the tests that care which door it was assert on it explicitly.
_ORIGIN = audit.Origin.mcp_gateway()


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def test_trust_view_reports_streaks(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    for _ in range(5):
        audit.log_event(
            db.conn, tenant_id=tenant, decision="allow", tool_name="crm.read", origin=_ORIGIN
        )
    audit.log_event(
        db.conn, tenant_id=tenant, decision="deny", tool_name="crm.write", origin=_ORIGIN
    )
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", tool_name="crm.write", origin=_ORIGIN
    )

    client = _client(db.url, test_verifier)
    rows = client.get("/v1/trust", headers=_auth(make_token(tenant_id=tenant, role="viewer")))
    assert rows.status_code == 200
    by_tool = {r["tool"]: r for r in rows.json()}
    assert by_tool["crm.read"]["clean_streak"] == 5 and by_tool["crm.read"]["trusted"] is True
    # A refusal broke the streak: only the most-recent clean approval counts.
    assert by_tool["crm.write"]["clean_streak"] == 1 and by_tool["crm.write"]["trusted"] is False


def test_trust_view_is_tenant_isolated(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="allow", tool_name="crm.read", origin=_ORIGIN
    )
    client = _client(db.url, test_verifier)
    other = make_token(tenant_id=str(uuid4()), role="viewer")
    assert client.get("/v1/trust", headers=_auth(other)).json() == []
