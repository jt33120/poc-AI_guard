"""The MCP gateway session is refused without a valid tenant token (SPEC §5.1)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from core.tenant_tokens import generate_token, hash_token
from gateway.server import authenticate_session
from tests.conftest import DBHandle


def test_session_authenticates_with_valid_token(db: DBHandle) -> None:
    tenant_id = uuid4()
    raw = generate_token()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    db.conn.execute(
        "insert into gateway_tokens (tenant_id, name, token_hash) values (%s, 'cli', %s)",
        (tenant_id, hash_token(raw)),
    )
    # La passerelle est une capacité accordée, pas un droit de l'inscription : un
    # jeton valide ne suffit plus. Le geste est explicite ici parce qu'il l'est en
    # production, où il accompagne l'offre de service.
    db.conn.execute("update tenants set mcp_gateway_enabled = true where id = %s", (tenant_id,))
    db.conn.commit()
    resolved_tenant, token_id = authenticate_session(db.url, raw)
    assert resolved_tenant == str(tenant_id)
    # The agent's identity travels with the tenant: the persisted taint is keyed
    # on it, so it cannot be left to whatever the agent declares (FR-154).
    assert token_id


def test_session_refused_without_token(db: DBHandle) -> None:
    with pytest.raises(PermissionError):
        authenticate_session(db.url, "")


def test_session_refused_with_unknown_token(db: DBHandle) -> None:
    with pytest.raises(PermissionError):
        authenticate_session(db.url, "bogus-token")


def test_a_session_is_refused_when_the_gateway_was_never_granted(db: DBHandle) -> None:
    """Le verrou, vu depuis la passerelle elle-même et non depuis la couche jeton.

    `authenticate_session` est le point d'entrée réel de `run_stdio` : c'est lui qui
    décide si un agent client obtient une session. Un contrôle qui ne vivrait que dans
    `core/tenant_tokens` laisserait passer une réécriture de ce chemin.
    """
    tenant_id = uuid4()
    raw = generate_token()
    db.conn.execute("insert into tenants (id, name) values (%s, 'B')", (tenant_id,))
    db.conn.execute(
        "insert into gateway_tokens (tenant_id, name, token_hash) values (%s, 'cli', %s)",
        (tenant_id, hash_token(raw)),
    )
    db.conn.commit()
    with pytest.raises(PermissionError, match="not enabled"):
        authenticate_session(db.url, raw)
