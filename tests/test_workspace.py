"""Product access is tenant-scoped, explicit and independent of gateway execution."""

from collections.abc import Callable
from uuid import uuid4

import psycopg
import pytest

from api.security import TokenVerifier
from core import db as database
from core import tenant_tokens
from tests.conftest import DBHandle
from tests.test_llm_proxy import _client, _tenant


def test_workspace_reads_only_own_product_access(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    own, other = _tenant(db), _tenant(db)
    db.conn.execute("update tenants set name='xSOM test' where id=%s", (own,))
    db.conn.execute(
        "insert into tenant_product_access (tenant_id,product,status,edition) values "
        "(%s,'secret_guard','internal','Équipe'), (%s,'ai_guard','active','Entreprise')",
        (own, other),
    )
    db.conn.commit()
    client = _client(db.url, test_verifier)
    assert client.get("/v1/workspace").status_code == 401
    headers = {"Authorization": f"Bearer {make_token(tenant_id=own, role='viewer')}"}
    response = client.get("/v1/workspace", headers=headers)
    assert response.status_code == 200
    view = response.json()
    assert view["organization"] == {"id": own, "name": "xSOM test"}
    assert [s["status"] for s in view["subscriptions"]] == ["internal", "unconfigured"]
    assert "access_token" not in response.text
    # A browser cannot pick another tenant or grant itself a subscription.
    assert client.get(f"/v1/workspace?tenant_id={other}", headers=headers).json() == view
    assert (
        client.post("/v1/workspace", headers=headers, json={"status": "active"}).status_code == 405
    )
    with database.tenant_reader(db.url, user_id=str(uuid4()), tenant_id=own) as conn:
        assert conn.execute(
            "select distinct tenant_id::text from tenant_product_access"
        ).fetchall() == [(own,)]
        with pytest.raises(psycopg.errors.InsufficientPrivilege), conn.transaction():
            conn.execute("update tenant_product_access set status='active'")


def test_expired_and_missing_access_are_not_active(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    db.conn.execute(
        "insert into tenant_product_access (tenant_id,product,status,edition,ends_at) values "
        "(%s,'secret_guard','trial','Équipe',now()-interval '1 second'), "
        "(%s,'ai_guard','not_subscribed','Gouvernance',null)",
        (tenant, tenant),
    )
    db.conn.commit()
    client = _client(db.url, test_verifier)
    headers = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    response = client.get("/v1/workspace", headers=headers)
    assert [s["status"] for s in response.json()["subscriptions"]] == ["expired", "not_subscribed"]
    # Product console access never grants permission to execute the MCP gateway.
    assert db.conn.execute(
        "select mcp_gateway_enabled from tenants where id=%s", (tenant,)
    ).fetchone() == (False,)


def test_approval_queues_are_separated_by_recorded_workstation_origin(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant, other = _tenant(db), _tenant(db)
    _, token = tenant_tokens.mint(db.conn, tenant_id=tenant, name="Synthetic workstation")
    device = str(uuid4())
    db.conn.execute(
        "insert into extension_devices "
        "(id,tenant_id,gateway_token_id,platform,extension_version,mode) "
        "values (%s,%s,%s,'linux','0.1.0','block')",
        (device, tenant, token["id"]),
    )
    for name, device_id in [("developer.deploy", device), ("business.send", None)]:
        db.conn.execute(
            "insert into approvals (tenant_id,request_id,tool_name,arguments_summary,dry_run,"
            "args_hash,expires_at,developer_device_id,developer_policy_id,developer_policy_version,"
            "developer_action_binding) values "
            "(%s,%s,%s,'{}','{}',%s,now()+interval '1 hour',%s,%s,%s,%s)",
            (
                tenant,
                name,
                name,
                "a" * 64,
                device_id,
                "team" if device_id else None,
                1 if device_id else None,
                "b" * 64 if device_id else None,
            ),
        )
    db.conn.commit()
    client = _client(db.url, test_verifier)
    headers = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='viewer')}"}
    for product, expected in [("secret_guard", "developer.deploy"), ("ai_guard", "business.send")]:
        response = client.get(f"/v1/approvals?status=pending&product={product}", headers=headers)
        assert response.status_code == 200
        assert [item["tool_name"] for item in response.json()] == [expected]
    assert len(client.get("/v1/approvals", headers=headers).json()) == 2
    assert client.get("/v1/approvals?product=wrong", headers=headers).status_code == 422
    other_headers = {"Authorization": f"Bearer {make_token(tenant_id=other, role='admin')}"}
    assert client.get("/v1/approvals?product=secret_guard", headers=other_headers).json() == []
