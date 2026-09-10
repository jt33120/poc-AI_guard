"""Gateway tenant tokens: hashing + fail-closed resolution (CLAUDE.md §4.4/§4.7)."""

from __future__ import annotations

from uuid import uuid4

import psycopg
import pytest

from core.tenant_tokens import (
    authenticate_gateway_principal,
    authenticate_gateway_session,
    generate_token,
    hash_token,
    resolve_tenant,
)
from tests.conftest import DBHandle


def _seed_token(conn: psycopg.Connection, *, revoked: bool = False) -> tuple[str, str]:
    tenant_id = uuid4()
    raw = generate_token()
    conn.execute("insert into tenants (id, name) values (%s, 'A')", (tenant_id,))
    conn.execute(
        "insert into gateway_tokens (tenant_id, name, token_hash) values (%s, 'cli', %s)",
        (tenant_id, hash_token(raw)),
    )
    if revoked:
        conn.execute(
            "update gateway_tokens set revoked_at = now() where token_hash = %s",
            (hash_token(raw),),
        )
    conn.commit()
    return str(tenant_id), raw


def test_hash_token_is_stable_sha256_hex() -> None:
    digest = hash_token("abc")
    assert len(digest) == 64
    assert digest == hash_token("abc")


def test_generate_token_is_unique() -> None:
    assert generate_token() != generate_token()


def test_resolve_valid_token(db: DBHandle) -> None:
    tenant_id, raw = _seed_token(db.conn)
    assert resolve_tenant(db.conn, raw) == tenant_id


def test_resolve_unknown_token_returns_none(db: DBHandle) -> None:
    assert resolve_tenant(db.conn, "does-not-exist") is None


def test_resolve_revoked_token_returns_none(db: DBHandle) -> None:
    _, raw = _seed_token(db.conn, revoked=True)
    assert resolve_tenant(db.conn, raw) is None


def _accorder_passerelle(conn: object, tenant_id: str) -> None:
    """Accorde la passerelle MCP à un tenant.

    Un geste explicite dans chaque test qui ouvre une session, parce que c'en est un
    en production : la capacité est accordée avec l'offre de service, jamais à
    l'inscription. Un test qui n'aurait pas à la poser signalerait que le verrou
    s'ouvre tout seul.
    """
    conn.execute(  # type: ignore[attr-defined]
        "update tenants set mcp_gateway_enabled = true where id = %s", (tenant_id,)
    )


def test_authenticate_valid_token_marks_last_used(db: DBHandle) -> None:
    tenant_id, raw = _seed_token(db.conn)
    _accorder_passerelle(db.conn, tenant_id)
    assert authenticate_gateway_session(db.conn, raw)[0] == tenant_id
    row = db.conn.execute(
        "select last_used_at from gateway_tokens where token_hash = %s", (hash_token(raw),)
    ).fetchone()
    assert row is not None and row[0] is not None


def test_authenticate_missing_token_is_refused(db: DBHandle) -> None:
    with pytest.raises(PermissionError):
        authenticate_gateway_session(db.conn, "")


def test_authenticate_revoked_token_is_refused(db: DBHandle) -> None:
    _, raw = _seed_token(db.conn, revoked=True)
    with pytest.raises(PermissionError):
        authenticate_gateway_session(db.conn, raw)


def test_a_tenant_without_the_grant_cannot_open_a_gateway_session(db: DBHandle) -> None:
    """Le verrou lui-même : jeton parfaitement valide, session refusée.

    C'est le contrôle qui porte la décision produit. La passerelle est la seule voie
    contraignante et elle demande une installation ; l'ouvrir sur la seule présentation
    d'un jeton d'inscription reviendrait à la livrer en libre-service, ce qu'elle n'est
    pas — sa configuration exige un `DATABASE_URL` qu'un inscrit n'a pas.
    """
    _, raw = _seed_token(db.conn)  # aucun `_accorder_passerelle`
    with pytest.raises(PermissionError, match="not enabled"):
        authenticate_gateway_session(db.conn, raw)


def test_the_grant_is_off_by_default(db: DBHandle) -> None:
    """Fail-closed à la création, et non par un réglage qu'on penserait à mettre.

    Si la colonne prenait `true` par défaut, tous les contrôles ci-dessus passeraient
    encore et le verrou n'existerait que sur le papier.
    """
    tenant_id, _ = _seed_token(db.conn)
    row = db.conn.execute(
        "select mcp_gateway_enabled from tenants where id = %s", (tenant_id,)
    ).fetchone()
    assert row is not None and row[0] is False


def test_the_cooperative_path_is_not_gated(db: DBHandle) -> None:
    """La contrepartie : le SaaS reste en libre-service, et c'est voulu.

    `/v1/authorize` et le proxy passent par `authenticate_gateway_principal`. Étendre
    le verrou jusqu'à eux fermerait l'offre libre-service en croyant durcir la
    passerelle — le genre de dégât qu'un test attrape et qu'une relecture laisse
    passer, parce que les deux fonctions se ressemblent.
    """
    tenant_id, raw = _seed_token(db.conn)  # non accordé
    token_id, resolu = authenticate_gateway_principal(db.conn, raw)
    assert resolu == tenant_id and token_id
